package com.dashboardstock.collector.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.dashboardstock.collector.api.SignalApiClient
import com.dashboardstock.collector.db.SentSignalCache
import com.dashboardstock.collector.db.SignalQueueManager
import com.dashboardstock.collector.parser.SmsRouter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * SMS 수신 BroadcastReceiver
 * - 키움증권 SMS 감지 → 파서 라우팅 → API 전송
 */
class SmsReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SmsReceiver"
        private const val KIWOOM_SENDER = "15449000"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // 동일 발신자의 멀티파트 SMS 합치기
        val sender = messages[0].displayOriginatingAddress ?: return
        val fullBody = messages.joinToString("") { it.displayMessageBody ?: "" }

        Log.d(TAG, "SMS from: $sender, length: ${fullBody.length}")

        // 키움증권 SMS인지 확인
        val source = SmsRouter.identify(sender, fullBody)
        if (source == SmsRouter.Source.UNKNOWN) {
            Log.d(TAG, "Not a Kiwoom signal SMS, ignoring")
            return
        }

        Log.i(TAG, "Kiwoom signal detected: source=$source")

        // MMS 원문 저장 (dailyReport용)
        CoroutineScope(Dispatchers.IO).launch {
            SignalApiClient.sendRawMms(sender, source.name.lowercase(), fullBody)
        }

        // 모든 소스(라씨/스톡봇/퀀트) → SMS/MMS 본문 직접 파싱 후 전송
        // (라씨 앱 알림에 의한 영웅문 스크래핑은 NotificationListener에서 처리)
        val signals = SmsRouter.parse(sender, fullBody)
        if (signals.isEmpty()) {
            Log.w(TAG, "Parsed 0 signals from $source SMS")
            return
        }

        Log.i(TAG, "Parsed ${signals.size} signals from $source")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val filtered = SentSignalCache.filterNew(context, signals)
                if (filtered.isEmpty()) {
                    Log.i(TAG, "All SMS signals already sent with same status")
                    return@launch
                }
                SignalApiClient.sendSignals(context, filtered)
                SentSignalCache.markSent(context, filtered)
                Log.i(TAG, "SMS signals sent: ${filtered.size}/${signals.size}")
            } catch (e: Exception) {
                Log.e(TAG, "API send failed, queuing offline", e)
                SignalQueueManager.enqueue(context, signals)
            }
        }
    }
}
