package com.dashboardstock.collector.db

import android.content.Context
import android.util.Log
import com.dashboardstock.collector.api.SignalApiClient
import com.dashboardstock.collector.api.SignalInput
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

/**
 * 오프라인 큐 관리자
 * - 전송 실패 시 Room DB에 저장
 * - 네트워크 복구 시 재전송
 */
object SignalQueueManager {

    private const val TAG = "SignalQueueManager"
    private val gson = Gson()

    /** 전송 실패한 신호를 큐에 저장 */
    suspend fun enqueue(context: Context, signals: List<SignalInput>) {
        val dao = AppDatabase.getInstance(context).signalQueueDao()
        val json = gson.toJson(signals)
        dao.insert(SignalQueueEntity(payload = json))
        Log.i(TAG, "Queued ${signals.size} signals for retry")
    }

    /** 큐에 저장된 신호를 재전송 시도 */
    suspend fun flush(context: Context) {
        val dao = AppDatabase.getInstance(context).signalQueueDao()
        dao.deleteExpired()

        val pending = dao.getPending()
        if (pending.isEmpty()) return

        Log.i(TAG, "Flushing ${pending.size} queued batches")

        for (entity in pending) {
            try {
                val type = object : TypeToken<List<SignalInput>>() {}.type
                val signals: List<SignalInput> = gson.fromJson(entity.payload, type)
                // 이미 전송 성공한 신호는 캐시로 필터링 (재시도 시 중복 방지)
                val filtered = SentSignalCache.filterNew(context, signals)
                if (filtered.isEmpty()) {
                    dao.delete(entity.id)
                    Log.i(TAG, "Skipped batch id=${entity.id}, all already sent")
                    continue
                }
                SignalApiClient.sendSignals(context, filtered)
                SentSignalCache.markSent(context, filtered)
                dao.delete(entity.id)
                Log.i(TAG, "Flushed batch id=${entity.id}, sent ${filtered.size}/${signals.size}")
            } catch (e: Exception) {
                Log.w(TAG, "Retry failed for id=${entity.id}, attempt=${entity.retryCount + 1}", e)
                dao.incrementRetry(entity.id)
            }
        }
    }

    /** 큐 대기 건수 */
    suspend fun pendingCount(context: Context): Int {
        return AppDatabase.getInstance(context).signalQueueDao().count()
    }
}
