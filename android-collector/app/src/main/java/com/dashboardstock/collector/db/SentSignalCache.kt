package com.dashboardstock.collector.db

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.dashboardstock.collector.api.SignalInput
import java.time.LocalDate
import java.time.ZoneId

/**
 * 전송 완료 신호 캐시 (SharedPreferences 기반)
 *
 * symbol:source → signalType 매핑을 저장하여
 * 같은 종목+소스의 동일한 상태(signalType)는 재전송하지 않도록 필터링.
 * 매일 자정(KST) 기준으로 자동 초기화.
 */
object SentSignalCache {

    private const val TAG = "SentSignalCache"
    private const val PREFS_NAME = "sent_signal_cache"
    private const val KEY_DATE = "_cache_date"

    private fun prefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /** 날짜가 바뀌었으면 캐시 초기화 */
    private fun resetIfNewDay(context: Context) {
        val p = prefs(context)
        val today = LocalDate.now(ZoneId.of("Asia/Seoul")).toString()
        val cached = p.getString(KEY_DATE, "")
        if (cached != today) {
            Log.i(TAG, "New day ($cached → $today), clearing cache")
            p.edit().clear().putString(KEY_DATE, today).apply()
        }
    }

    /**
     * 전송할 신호 목록에서 이미 동일 상태로 전송된 것을 제외
     * @return 새로 전송해야 하는 신호만 반환
     */
    fun filterNew(context: Context, signals: List<SignalInput>): List<SignalInput> {
        resetIfNewDay(context)
        val p = prefs(context)

        return signals.filter { s ->
            if (s.symbol == null) {
                true // symbol 없는 건 항상 전송
            } else {
                val baseKey = "${s.symbol}:${s.source}:${s.signalType}"
                val timeKey = s.signalTime ?: ""
                val fullKey = "$baseKey:$timeKey"
                when {
                    // 정확히 같은 키(signalTime 포함)로 이미 전송됨
                    p.contains(fullKey) -> {
                        Log.d(TAG, "Skip duplicate: ${s.name}(${s.symbol}) ${s.signalType} @${timeKey}")
                        false
                    }
                    // signalTime=NULL인데, 같은 종목이 signalTime 있는 버전으로 이미 전송됨
                    // baseKey: 접두사로 시작하는 키가 있는지 확인
                    s.signalTime == null && p.all.keys.any { it.startsWith("$baseKey:") && it != "$baseKey:" } -> {
                        Log.d(TAG, "Skip null-time duplicate: ${s.name}(${s.symbol}) ${s.signalType} (already sent with time)")
                        false
                    }
                    else -> true
                }
            }
        }
    }

    /**
     * 전송 성공 후 캐시에 기록
     */
    fun markSent(context: Context, signals: List<SignalInput>) {
        resetIfNewDay(context)
        val editor = prefs(context).edit()
        for (s in signals) {
            if (s.symbol != null) {
                val timeKey = s.signalTime ?: ""
                val key = "${s.symbol}:${s.source}:${s.signalType}:${timeKey}"
                editor.putString(key, "1")
            }
        }
        editor.apply()
        Log.d(TAG, "Cached ${signals.count { it.symbol != null }} signals")
    }

    /**
     * PATCH로 null→절대시간 업데이트 성공 시, null 키를 제거
     * → 같은 종목의 다음 null 신호(다른 시간대)가 캐시에 걸리지 않도록
     */
    fun removeNullTimeKey(context: Context, s: SignalInput) {
        val nullKey = "${s.symbol}:${s.source}:${s.signalType}:"
        val p = prefs(context)
        if (p.contains(nullKey)) {
            p.edit().remove(nullKey).apply()
            Log.d(TAG, "Removed null-time cache key: $nullKey")
        }
    }

    /** 캐시 크기 (디버그용) */
    fun size(context: Context): Int {
        resetIfNewDay(context)
        return prefs(context).all.size - 1 // _cache_date 제외
    }
}
