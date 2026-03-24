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
 * 키: symbol:source:signalType (signalTime 미포함)
 * 같은 종목+소스+타입은 하루에 한 번만 INSERT.
 * signal_time 업데이트는 PATCH로 별도 처리.
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

    private fun cacheKey(s: SignalInput): String =
        "${s.symbol}:${s.source}:${s.signalType}"

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
                val key = cacheKey(s)
                if (p.contains(key)) {
                    Log.d(TAG, "Skip duplicate: ${s.name}(${s.symbol}) ${s.signalType}")
                    false
                } else {
                    true
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
                editor.putString(cacheKey(s), "1")
            }
        }
        editor.apply()
        Log.d(TAG, "Cached ${signals.count { it.symbol != null }} signals")
    }

    /** 캐시 크기 (디버그용) */
    fun size(context: Context): Int {
        resetIfNewDay(context)
        return prefs(context).all.size - 1 // _cache_date 제외
    }
}
