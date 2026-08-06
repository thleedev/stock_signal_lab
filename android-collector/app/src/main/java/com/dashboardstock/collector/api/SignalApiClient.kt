package com.dashboardstock.collector.api

import android.content.Context
import android.util.Log
import com.dashboardstock.collector.BuildConfig
import com.google.gson.GsonBuilder
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Supabase REST API 직접 연결 클라이언트
 */
object SignalApiClient {

    private const val TAG = "SignalApiClient"
    private val gson = GsonBuilder().serializeNulls().create()
    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

    /**
     * 하트비트 전송 전용 스코프
     *
     * AccessibilityService 의 스코프를 빌려 쓰면 onDestroy 의 scope.cancel() 로 전송 중이던
     * 하트비트가 함께 취소됩니다. 서비스 수명과 분리해 앱 프로세스 수명으로 둡니다.
     */
    private val heartbeatScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = if (BuildConfig.DEBUG)
                        HttpLoggingInterceptor.Level.BODY
                    else
                        HttpLoggingInterceptor.Level.NONE
                }
            )
            .build()
    }

    private fun supabaseRequest(path: String): Request.Builder {
        val url = "${BuildConfig.SUPABASE_URL}/rest/v1/$path"
        return Request.Builder()
            .url(url)
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            .header("Content-Type", "application/json")
    }

    /**
     * 신호 리스트를 Supabase upsert_signals_bulk RPC로 전송
     *
     * DB에서 같은 (symbol, source, signal_type, 날짜KST) 중복은 자동으로
     * signal_time = COALESCE(new, existing) 으로 업데이트됨.
     * 수집기는 단순히 모든 신호를 그대로 보내면 됨.
     *
     * @throws Exception 전송 실패 시 (호출부에서 Room 큐잉 처리)
     */
    suspend fun sendSignals(context: Context, signals: List<SignalInput>) {
        if (signals.isEmpty()) return

        val batchId = UUID.randomUUID().toString()
        Log.d(TAG, "Sending ${signals.size} signals via upsert RPC, batch=$batchId")

        val rows = signals.map { s ->
            SignalRow(
                timestamp  = s.timestamp, symbol = s.symbol, name = s.name,
                signalType = s.signalType, signalPrice = s.signalPrice,
                signalTime = s.signalTime, source = s.source, batchId = batchId,
                isFallback = s.isFallback, rawData = buildRawData(s),
                deviceId   = BuildConfig.DEVICE_ID
            )
        }

        // payload 키로 감싸서 RPC 호출
        val payloadJson = gson.toJson(rows)
        val body = """{"payload":$payloadJson}""".toRequestBody(JSON_TYPE)

        val request = supabaseRequest("rpc/upsert_signals_bulk")
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        val code = response.code
        val respBody = response.body?.string()
        response.close()

        if (!response.isSuccessful) {
            Log.e(TAG, "upsert_signals_bulk failed ($code): $respBody")
            throw Exception("RPC upsert failed: $code")
        }

        Log.i(TAG, "upsert_signals_bulk OK: ${signals.size} signals, batch=$batchId")
        // 이미 IO 스레드(suspend 호출부)이므로 스코프를 새로 띄우지 않고 바로 전송합니다.
        postHeartbeat("active", null, markSignal = true)
        triggerAiRecommendations()
    }

    /**
     * MMS 원문을 mms_raw_messages 테이블에 저장
     */
    fun sendRawMms(sender: String, source: String, body: String) {
        try {
            val row = mapOf(
                "sender" to sender,
                "source" to source,
                "body" to body,
                "device_id" to BuildConfig.DEVICE_ID
            )
            val reqBody = gson.toJson(row).toRequestBody(JSON_TYPE)
            val request = supabaseRequest("mms_raw_messages")
                .header("Prefer", "return=minimal")
                .post(reqBody)
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                Log.w(TAG, "Raw MMS save failed (${response.code}): ${response.body?.string()}")
            } else {
                Log.d(TAG, "Raw MMS saved: source=$source, len=${body.length}")
            }
            response.close()
        } catch (e: Exception) {
            Log.w(TAG, "Raw MMS save error", e)
        }
    }

    /**
     * 웹앱 AI 추천 생성 API 호출 (신호 수집 완료 후)
     * WEBAPP_URL이 설정되지 않으면 무시
     */
    private fun triggerAiRecommendations() {
        val webappUrl = BuildConfig.WEBAPP_URL
        if (webappUrl.isBlank()) {
            Log.d(TAG, "WEBAPP_URL not set, skipping AI recommendations trigger")
            return
        }
        try {
            val body = """{}""".toRequestBody(JSON_TYPE)
            val request = Request.Builder()
                .url("$webappUrl/api/v1/ai-recommendations/generate")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                Log.i(TAG, "AI recommendations triggered successfully")
            } else {
                Log.w(TAG, "AI recommendations trigger failed (${response.code})")
            }
            response.close()
        } catch (e: Exception) {
            Log.w(TAG, "AI recommendations trigger error", e)
        }
    }

    /**
     * 수집기 상태를 collector_heartbeats 에 기록합니다 (fire-and-forget).
     *
     * KiwoomAccessibilityService 와 AlphaCatchAccessibilityService 가 함께 씁니다.
     * 메인 스레드에서 불러도 되도록 내부 IO 스코프에서 실행하며, 전송 실패는 로그로만 남기고
     * 예외를 던지지 않습니다. 하트비트 때문에 스크래핑 흐름이 멈추면 안 됩니다.
     *
     * collector_heartbeats 에는 수집 주체를 담는 컬럼이 없고 device_id 는 기기 단위이므로,
     * 어느 수집기가 남긴 기록인지는 [message] 앞의 접두어("알파캐치: ", "라씨: ")로 구분합니다.
     *
     * @param status "active" 또는 "error"
     * @param message error_message 컬럼 값. 대시보드(web/src/app/collector/page.tsx)가 값이 있으면
     *                붉은 "오류:" 줄로 표시하므로 정상 경로에서는 null 로 둡니다.
     * @param markSignal 신호를 실제로 전송했을 때만 true — last_signal 을 현재 시각으로 채웁니다.
     */
    fun reportHeartbeat(status: String, message: String? = null, markSignal: Boolean = false) {
        heartbeatScope.launch { postHeartbeat(status, message, markSignal) }
    }

    /** 하트비트 1건 INSERT. 네트워크를 직접 호출하므로 IO 스레드에서만 실행합니다. */
    private fun postHeartbeat(status: String, message: String?, markSignal: Boolean) {
        try {
            val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            val lastSignal: String? = if (markSignal) now else null

            val hb = mapOf(
                "device_id" to BuildConfig.DEVICE_ID,
                "status" to status,
                "last_signal" to lastSignal,
                "timestamp" to now,
                "error_message" to message
            )

            val body = gson.toJson(hb).toRequestBody(JSON_TYPE)
            val request = supabaseRequest("collector_heartbeats")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                Log.w(TAG, "Heartbeat failed (${response.code}): ${response.body?.string()}")
            } else {
                Log.i(TAG, "Heartbeat sent: status=$status, message=$message")
            }
            response.close()
        } catch (e: Exception) {
            Log.w(TAG, "Heartbeat update failed", e)
        }
    }

    /**
     * signal_time이 null인 기존 신호의 시간을 보정 (오후 5시 일괄 업데이트용)
     *
     * 매칭 조건: symbol + source + signal_type + signal_time IS NULL
     *   + timestamp가 보정할 signal_time ±2시간 이내
     *
     * 같은 종목이 오전/오후에 각각 신호가 나와도 시간 근접성으로 올바른 행만 PATCH
     */
    suspend fun updateSignalTimes(signals: List<SignalInput>) {
        if (signals.isEmpty()) return

        var updated = 0
        for (s in signals) {
            if (s.symbol == null || s.signalTime == null) continue

            // signal_time 기준 ±2시간 범위 계산 ('+' → %2B URL 인코딩)
            val signalOdt = OffsetDateTime.parse(s.signalTime)
            val rangeStart = signalOdt.minusHours(2)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                .replace("+", "%2B")
            val rangeEnd = signalOdt.plusHours(2)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
                .replace("+", "%2B")

            // signal_time IS NULL + timestamp가 ±2시간 이내인 행만 PATCH
            val path = "signals?symbol=eq.${s.symbol}" +
                    "&source=eq.${s.source}" +
                    "&signal_type=eq.${s.signalType}" +
                    "&signal_time=is.null" +
                    "&timestamp=gte.${rangeStart}" +
                    "&timestamp=lte.${rangeEnd}"

            val patchBody = gson.toJson(mapOf("signal_time" to s.signalTime))
                .toRequestBody(JSON_TYPE)

            val request = supabaseRequest(path)
                .header("Prefer", "return=minimal")
                .patch(patchBody)
                .build()

            try {
                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    updated++
                } else {
                    Log.w(TAG, "PATCH failed for ${s.symbol}: ${response.code}")
                }
                response.close()
            } catch (e: Exception) {
                Log.w(TAG, "PATCH error for ${s.symbol}", e)
            }
        }
        Log.i(TAG, "Updated signal_time for $updated/${signals.size} signals")
    }

    /**
     * 알파캐치 보유 종목 전체 덮어쓰기 (Supabase REST 직접 호출)
     * 1) 기존 행 전체 DELETE → 2) 새 행 일괄 INSERT
     *
     * 빈 목록은 "보유 종목이 0건"이 아니라 스크래핑 실패로 봅니다. 알파추천 화면에는 보유 종목
     * 섹션이 상시 노출되므로 0건은 팝업·레이아웃 변경으로 파서가 아무것도 읽지 못한 경우입니다.
     * 이때 DELETE 를 실행하면 스크래핑 실패가 그대로 보유 종목 전량 삭제로 이어지므로 건너뜁니다.
     * 의도적으로 전량 비우는 용법은 이 함수의 유일한 호출부인
     * AlphaCatchAccessibilityService.onComplete 에 없습니다.
     */
    suspend fun sendAlphaCatchHoldings(items: List<AlphaCatchHoldingInput>) {
        if (items.isEmpty()) {
            Log.w(TAG, "Holdings sync skipped: 수집 0건이므로 기존 행을 삭제하지 않습니다")
            return
        }

        // 1) 기존 행 전체 삭제 (?symbol=neq.<empty>로 모든 행 매칭)
        val deleteReq = supabaseRequest("alphacatch_holdings?symbol=neq.__none__")
            .header("Prefer", "return=minimal")
            .delete()
            .build()
        try {
            val resp = client.newCall(deleteReq).execute()
            if (!resp.isSuccessful) {
                Log.w(TAG, "Holdings DELETE failed (${resp.code}): ${resp.body?.string()}")
            }
            resp.close()
        } catch (e: Exception) {
            Log.w(TAG, "Holdings DELETE error", e)
        }

        // 2) 새 행 일괄 INSERT
        val rows = items.map { h ->
            mapOf(
                "symbol" to (h.symbol.ifBlank { h.name }),  // symbol 미노출 시 name을 PK로 임시 사용
                "name" to h.name,
                "return_pct" to h.returnPct,
                "close_price" to h.closePrice,
                "avg_buy_price" to h.avgBuyPrice,
                "bought_at" to h.boughtAt
            )
        }
        val body = gson.toJson(rows).toRequestBody(JSON_TYPE)
        val insertReq = supabaseRequest("alphacatch_holdings")
            .header("Prefer", "return=minimal")
            .post(body)
            .build()

        val resp = client.newCall(insertReq).execute()
        if (!resp.isSuccessful) {
            Log.e(TAG, "Holdings INSERT failed (${resp.code}): ${resp.body?.string()}")
            resp.close()
            throw Exception("Holdings insert failed: ${resp.code}")
        }
        resp.close()
        Log.i(TAG, "Holdings synced: ${items.size}")
    }

    private fun buildRawData(s: SignalInput): Map<String, Any?>? {
        val map = mutableMapOf<String, Any?>()
        s.rawData?.let { map.putAll(it) }
        s.signalPrice?.let { map["signal_price"] = it }
        s.timeGroup?.let { map["time_group"] = it }
        return if (map.isEmpty()) null else map
    }
}

/** Supabase signals 테이블 INSERT용 row */
data class SignalRow(
    val timestamp: String,
    val symbol: String?,
    val name: String,
    @SerializedName("signal_type") val signalType: String,
    @SerializedName("signal_price") val signalPrice: Int?,
    @SerializedName("signal_time") val signalTime: String?,
    val source: String,
    @SerializedName("batch_id") val batchId: String,
    @SerializedName("is_fallback") val isFallback: Boolean,
    @SerializedName("raw_data") val rawData: Map<String, Any?>?,
    @SerializedName("device_id") val deviceId: String
)
