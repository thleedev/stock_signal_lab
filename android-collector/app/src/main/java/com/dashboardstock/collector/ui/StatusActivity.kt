package com.dashboardstock.collector.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.provider.Telephony
import android.util.Log
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.dashboardstock.collector.R
import com.dashboardstock.collector.api.SignalApiClient
import com.dashboardstock.collector.api.SignalInput
import com.dashboardstock.collector.db.SignalQueueManager
import com.dashboardstock.collector.parser.SmsRouter
import com.dashboardstock.collector.service.CollectorForegroundService
import com.dashboardstock.collector.service.KiwoomAccessibilityService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.TimeZone

class StatusActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "StatusActivity"
        private const val KIWOOM_SENDER = "15449000"
        private const val SMS_PERMISSION_REQUEST = 100

    }

    private lateinit var tvResult: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_status)

        tvResult = findViewById(R.id.tvCollectResult)

        startCollectorService()

        findViewById<Button>(R.id.btnNotificationAccess).setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        findViewById<Button>(R.id.btnAccessibility).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        findViewById<Button>(R.id.btnRefresh).setOnClickListener {
            updateStatus()
        }

        // 수집 버튼
        findViewById<Button>(R.id.btnCollect).setOnClickListener {
            collectToday()
        }


        updateStatus()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    /**
     * 오늘 MMS 수집 + 라씨매매 화면 스크래핑 실행
     */
    private fun collectToday() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.READ_SMS),
                SMS_PERMISSION_REQUEST
            )
            return
        }

        tvResult.text = "MMS 수집 중..."

        CoroutineScope(Dispatchers.IO).launch {
            val result = StringBuilder()
            var totalSent = 0

            // 1) MMS 인박스에서 오늘 키움증권 MMS 읽기
            try {
                val mmsList = readTodayMms()
                result.appendLine("MMS ${mmsList.size}건 발견 (1544-9000)")

                val allSignals = mutableListOf<SignalInput>()
                for ((index, body) in mmsList.withIndex()) {
                    val source = SmsRouter.identify(KIWOOM_SENDER, body)
                    val signals = SmsRouter.parse(KIWOOM_SENDER, body)
                    val preview = body.take(40).replace("\n", " ")
                    result.appendLine("  #${index + 1}: $source → ${signals.size}건 [$preview...]")
                    allSignals.addAll(signals)
                    // MMS 원문 저장 (dailyReport용)
                    SignalApiClient.sendRawMms(KIWOOM_SENDER, source.name.lowercase(), body)
                }

                if (allSignals.isNotEmpty()) {
                    result.appendLine()
                    result.appendLine("신호 ${allSignals.size}건 Supabase 전송 중...")
                    withContext(Dispatchers.Main) { tvResult.text = result.toString() }

                    SignalApiClient.sendSignals(applicationContext, allSignals)
                    totalSent += allSignals.size
                    result.appendLine("전송 완료! (${allSignals.size}건)")
                    result.appendLine()
                    for (s in allSignals) {
                        result.appendLine("  ${s.source} ${s.signalType} ${s.name} (${s.symbol ?: "?"})")
                    }
                } else {
                    result.appendLine("파싱된 매매 신호 없음 (시황/브리핑은 스킵)")
                }
            } catch (e: Exception) {
                result.appendLine("MMS 수집 오류: ${e.message}")
                Log.e(TAG, "MMS collect error", e)
            }

            result.appendLine()

            // 2) 라씨매매 화면 스크래핑 (AccessibilityService 트리거)
            val a11y = KiwoomAccessibilityService.instance
            if (a11y != null) {
                result.appendLine("라씨매매 화면 스크래핑 시작...")
                withContext(Dispatchers.Main) {
                    tvResult.text = result.toString()

                    // 스크래핑 결과 콜백 등록
                    KiwoomAccessibilityService.onScrapingResult = { buyCount, sellCount, success, error ->
                        val scrapResult = buildString {
                            appendLine()
                            appendLine("=== 라씨매매 스크래핑 결과 ===")
                            appendLine("매수: ${buyCount}건, 매도: ${sellCount}건")
                            if (success) {
                                appendLine("Supabase 전송 완료! (${buyCount + sellCount}건)")
                            } else {
                                appendLine("전송 실패 (오프라인 큐 저장): $error")
                            }
                        }
                        tvResult.append(scrapResult)
                    }

                    a11y.startScraping()
                }
                result.appendLine("→ 키움증권 앱에서 스크래핑 진행 중...")
            } else {
                result.appendLine("라씨매매: 접근성 서비스 비활성 (설정 필요)")
            }

            result.appendLine()
            result.appendLine("=== MMS 수집 완료: ${totalSent}건 전송 ===")
            result.appendLine("(라씨매매 스크래핑은 키움앱에서 진행 중...)")

            withContext(Dispatchers.Main) {
                tvResult.text = result.toString()
            }
        }
    }

    /**
     * 오늘 키움증권 MMS 읽기
     * MMS는 content://mms에 저장되며, 본문은 content://mms/{id}/part에 있음
     */
    private fun readTodayMms(): List<String> {
        val results = mutableListOf<String>()

        // 오늘 00:00 (KST) — MMS date는 초 단위
        val cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"))
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        val todayStartSec = cal.timeInMillis / 1000

        // 1) 오늘 MMS ID 목록 조회
        val mmsUri = Uri.parse("content://mms")
        val mmsCursor = contentResolver.query(
            mmsUri,
            arrayOf("_id", "date"),
            "date >= ?",
            arrayOf(todayStartSec.toString()),
            "date DESC"
        )

        val mmsIds = mutableListOf<Long>()
        mmsCursor?.use {
            val idIdx = it.getColumnIndexOrThrow("_id")
            while (it.moveToNext()) {
                mmsIds.add(it.getLong(idIdx))
            }
        }

        Log.d(TAG, "Today MMS count: ${mmsIds.size}")

        // 2) 각 MMS의 발신자 확인 + 본문 읽기
        for (mmsId in mmsIds) {
            val sender = getMmsSender(mmsId)
            if (sender == null || !sender.contains("15449000")) continue

            val body = getMmsBody(mmsId)
            if (!body.isNullOrBlank()) {
                results.add(body)
            }
        }

        return results
    }

    /** MMS 발신자 번호 조회 */
    private fun getMmsSender(mmsId: Long): String? {
        val addrUri = Uri.parse("content://mms/$mmsId/addr")
        val cursor = contentResolver.query(
            addrUri,
            arrayOf("address", "type"),
            "type=137", // 137 = FROM
            null,
            null
        )

        var sender: String? = null
        cursor?.use {
            if (it.moveToFirst()) {
                sender = it.getString(it.getColumnIndexOrThrow("address"))
            }
        }
        return sender
    }

    /** MMS 본문 텍스트 추출 */
    private fun getMmsBody(mmsId: Long): String? {
        val partUri = Uri.parse("content://mms/$mmsId/part")
        val cursor = contentResolver.query(
            partUri,
            arrayOf("_id", "ct", "text"),
            "ct = 'text/plain'",
            null,
            null
        )

        var body: String? = null
        cursor?.use {
            if (it.moveToFirst()) {
                body = it.getString(it.getColumnIndexOrThrow("text"))
            }
        }
        return body
    }


    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == SMS_PERMISSION_REQUEST && grantResults.isNotEmpty()
            && grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) {
            collectToday()
        } else {
            tvResult.text = "SMS/MMS 읽기 권한이 필요합니다"
        }
    }

    private fun startCollectorService() {
        val intent = Intent(this, CollectorForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun updateStatus() {
        val statusText = findViewById<TextView>(R.id.tvStatus)
        val notifEnabled = Settings.Secure.getString(
            contentResolver, "enabled_notification_listeners"
        )?.contains(packageName) == true
        val accessEnabled = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        )?.contains(packageName) == true

        CoroutineScope(Dispatchers.IO).launch {
            val queueCount = SignalQueueManager.pendingCount(applicationContext)
            withContext(Dispatchers.Main) {
                statusText.text = buildString {
                    appendLine("=== 주식 신호 수집기 상태 ===")
                    appendLine()
                    appendLine("알림 접근 권한: ${if (notifEnabled) "ON" else "OFF"}")
                    appendLine("접근성 서비스: ${if (accessEnabled) "ON" else "OFF"}")
                    appendLine("오프라인 큐: ${queueCount}건 대기 중")
                    appendLine()
                    appendLine("MMS 수신: 1544-9000 (키움증권)")
                    appendLine("푸시 감지: ${if (notifEnabled) "활성" else "비활성"}")
                }
            }
        }
    }

}
