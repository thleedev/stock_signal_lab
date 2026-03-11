package com.dashboardstock.collector.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dashboardstock.collector.R
import com.dashboardstock.collector.db.SignalQueueManager
import kotlinx.coroutines.*

/**
 * Foreground Service
 * - 수집기 상시 실행 보장
 * - 주기적으로 오프라인 큐 플러시
 */
class CollectorForegroundService : Service() {

    companion object {
        private const val TAG = "CollectorService"
        private const val CHANNEL_ID = "collector_channel"
        private const val NOTIFICATION_ID = 1001
        private const val FLUSH_INTERVAL_MS = 5 * 60 * 1000L // 5분
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("수집기 실행 중"))
        startQueueFlushLoop()
        Log.i(TAG, "Collector service started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // 시스템이 종료하면 재시작
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope.cancel()
        Log.i(TAG, "Collector service destroyed")
        super.onDestroy()
    }

    private fun startQueueFlushLoop() {
        scope.launch {
            while (isActive) {
                try {
                    SignalQueueManager.flush(applicationContext)
                    val pending = SignalQueueManager.pendingCount(applicationContext)
                    if (pending > 0) {
                        updateNotification("수집기 실행 중 (대기: ${pending}건)")
                    } else {
                        updateNotification("수집기 실행 중")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Queue flush error", e)
                }
                delay(FLUSH_INTERVAL_MS)
            }
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "신호 수집기",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "주식 신호 수집기 상시 실행"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("주식 신호 수집기")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }
}
