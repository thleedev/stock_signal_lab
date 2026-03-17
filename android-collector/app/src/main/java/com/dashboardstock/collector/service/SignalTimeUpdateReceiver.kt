package com.dashboardstock.collector.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

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

        val a11y = KiwoomAccessibilityService.instance
        if (a11y != null) {
            Log.i(TAG, "Starting update-mode scraping")
            a11y.startScraping(isUpdate = true)
        } else {
            Log.w(TAG, "AccessibilityService not available, skipping update")
        }

        // 다음 날 알람 재등록
        CollectorForegroundService.scheduleSignalTimeUpdate(context)
    }
}
