package com.dashboardstock.collector.service

import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

/**
 * 푸시 알림 감지 서비스
 * - 키움증권 관련 앱(영웅문, 라씨 등)의 푸시 알림 감지
 * - 라씨매매신호 알림 시 → AccessibilityService 스크래핑 자동 트리거
 * - 쿨다운(3분) 적용으로 중복 트리거 방지
 */
class NotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "NotificationListener"

        // 키움증권 관련 패키지
        private val KIWOOM_PACKAGES = setOf(
            "com.kiwoom.smartopen",  // 영웅문S
            "com.kiwoom.heromts",    // 영웅문S MTS
            "com.kiwoom.hero4"       // 영웅문4
        )

        // 라씨 관련 키워드
        private val LASSI_KEYWORDS = listOf("라씨매매", "라씨 매매", "매매신호")

        // 스크래핑 쿨다운: 3분
        private const val SCRAPING_COOLDOWN_MS = 3 * 60 * 1000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var lastScrapingTrigger = 0L

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return

        // 키움증권 관련 앱이 아니면 무시
        if (pkg !in KIWOOM_PACKAGES) return

        val extras = sbn.notification.extras
        val title = extras.getString("android.title") ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val fullText = "$title $text"

        Log.i(TAG, "Kiwoom notification from $pkg: title='$title' text='${text.take(50)}'")

        // 라씨매매신호 관련 알림인지 확인
        val isLassi = LASSI_KEYWORDS.any { fullText.contains(it) }
        if (!isLassi) {
            Log.d(TAG, "Not a Lassi notification, ignoring")
            return
        }

        // 쿨다운 체크
        val now = System.currentTimeMillis()
        if (now - lastScrapingTrigger < SCRAPING_COOLDOWN_MS) {
            val remaining = (SCRAPING_COOLDOWN_MS - (now - lastScrapingTrigger)) / 1000
            Log.i(TAG, "Scraping cooldown active (${remaining}s left), skipping")
            return
        }

        // AccessibilityService로 스크래핑 트리거
        val a11y = KiwoomAccessibilityService.instance
        if (a11y != null) {
            lastScrapingTrigger = now
            Log.i(TAG, ">>> Lassi notification detected - triggering auto scraping <<<")
            // 메인 스레드에서 약간 딜레이 후 실행 (알림 처리 완료 대기)
            handler.postDelayed({
                a11y.startScraping()
            }, 2000)
        } else {
            Log.w(TAG, "Lassi notification detected but AccessibilityService not active")
        }
    }
}
