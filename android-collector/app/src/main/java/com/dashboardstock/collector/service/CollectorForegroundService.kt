package com.dashboardstock.collector.service

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dashboardstock.collector.R
import com.dashboardstock.collector.db.SignalQueueManager
import kotlinx.coroutines.*
import java.util.Calendar
import java.util.TimeZone

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
        private const val UPDATE_HOUR_KST = 17 // 오후 5시
        private const val UPDATE_MINUTE_KST = 0

        /**
         * 다음 오후 5시(KST)에 signal_time 보정 알람 등록
         */
        fun scheduleSignalTimeUpdate(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, SignalTimeUpdateReceiver::class.java).apply {
                action = SignalTimeUpdateReceiver.ACTION_UPDATE_SIGNAL_TIMES
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul")).apply {
                set(Calendar.HOUR_OF_DAY, UPDATE_HOUR_KST)
                set(Calendar.MINUTE, UPDATE_MINUTE_KST)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                // 이미 지났으면 내일로
                if (timeInMillis <= System.currentTimeMillis()) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }

            // 주말 제외 (토=7, 일=1)
            while (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY
                || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
                cal.add(Calendar.DAY_OF_YEAR, 1)
            }

            alarmManager.setAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                cal.timeInMillis,
                pendingIntent
            )

            Log.i(TAG, "Signal time update scheduled: ${cal.time}")
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("수집기 실행 중"))
        startQueueFlushLoop()
        scheduleSignalTimeUpdate(this)
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
