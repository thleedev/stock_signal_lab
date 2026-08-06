package com.dashboardstock.collector.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.dashboardstock.collector.api.SignalApiClient

/**
 * 오후 5시(KST) 일괄 signal_time 보정 트리거
 *
 * 장 마감(15:30) 이후 충분한 시간이 지나면
 * 라씨매매 앱의 모든 시간이 절대시간으로 표시됨.
 * 이때 재스크래핑하여 상대시간(null)이었던 signal_time을 PATCH.
 */
class SignalTimeUpdateReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SignalTimeUpdate"
        const val ACTION_UPDATE_SIGNAL_TIMES = "com.dashboardstock.collector.UPDATE_SIGNAL_TIMES"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_UPDATE_SIGNAL_TIMES) return

        Log.i(TAG, "Signal time update alarm triggered")

        val lassi = KiwoomAccessibilityService.instance
        if (lassi != null) {
            Log.i(TAG, "Starting update-mode scraping (라씨)")
            // 라씨 완료 후 알파캐치 순차 실행 (영웅문 동시 진입 방지)
            val originalCallback = KiwoomAccessibilityService.onScrapingResult
            KiwoomAccessibilityService.onScrapingResult = { buy, sell, ok, err ->
                originalCallback?.invoke(buy, sell, ok, err)
                KiwoomAccessibilityService.onScrapingResult = originalCallback
                Handler(Looper.getMainLooper()).postDelayed({
                    val ac = AlphaCatchAccessibilityService.instance
                    if (ac != null) {
                        Log.i(TAG, "Starting AlphaCatch scraping after Lassi")
                        ac.startScraping()
                    } else {
                        reportAlphaCatchUnavailable()
                    }
                }, 5000)
            }
            lassi.startScraping(isUpdate = true)
        } else {
            Log.w(TAG, "Kiwoom (라씨) service not available, trying AlphaCatch directly")
            val ac = AlphaCatchAccessibilityService.instance
            if (ac != null) {
                ac.startScraping()
            } else {
                reportAlphaCatchUnavailable()
            }
        }

        // 다음 날 알람 재등록
        CollectorForegroundService.scheduleSignalTimeUpdate(context)
    }

    /**
     * 접근성 서비스가 연결되지 않아 알파캐치 수집을 시작조차 못한 상황을 서버에 알립니다.
     *
     * 이 경로는 로그만 남기면 대시보드에 그날 아침 하트비트가 그대로 남아 정상으로 보입니다.
     */
    private fun reportAlphaCatchUnavailable() {
        Log.w(TAG, "AlphaCatchAccessibilityService not available")
        SignalApiClient.reportHeartbeat("error", "알파캐치: 접근성 서비스 미연결 — 17시 수집 시작 실패")
    }
}
