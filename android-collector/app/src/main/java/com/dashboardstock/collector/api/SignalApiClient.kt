package com.dashboardstock.collector.api

import android.content.Context
import android.util.Log
import com.dashboardstock.collector.BuildConfig
import com.google.gson.GsonBuilder
import com.google.gson.annotations.SerializedName
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

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = if (BuildConfig.DEBUG)
                        HttpLoggingInterceptor.Level.BODY
                    else
                        HttpLoggingInterceptor.Level.BASIC
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
     * 신호 리스트를 Supabase에 직접 전송
     * @throws Exception 전송 실패 시 (호출부에서 Room 큐잉 처리)
     */
    suspend fun sendSignals(context: Context, signals: List<SignalInput>) {
        if (signals.isEmpty()) return

        val batchId = UUID.randomUUID().toString()
        Log.d(TAG, "Sending ${signals.size} signals, batch=$batchId")

        // signals 테이블에 맞는 row 형식으로 변환
        val rows = signals.map { s ->
            SignalRow(
                timestamp = s.timestamp,
                symbol = s.symbol,
                name = s.name,
                signalType = s.signalType,
                signalPrice = s.signalPrice,
                signalTime = s.signalTime,
                source = s.source,
                batchId = batchId,
                isFallback = s.isFallback,
                rawData = buildRawData(s),
                deviceId = BuildConfig.DEVICE_ID
            )
        }

        // 모든 신호를 INSERT (append) — 매수/매도 이력을 쌓아서 쌍 추적 가능
        // 중복 방지는 앱 SentSignalCache + DB unique constraint로 처리
        val body = gson.toJson(rows).toRequestBody(JSON_TYPE)
        val request = supabaseRequest("signals")
            .header("Prefer", "return=minimal")
            .post(body)
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            val errorBody = response.body?.string() ?: "unknown error"
            response.close()
            throw RuntimeException("Supabase insert failed (${response.code}): $errorBody")
        }
        response.close()
        Log.i(TAG, "Inserted ${rows.size} signals")

        // heartbeat 업데이트
        sendHeartbeat()
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

    private fun sendHeartbeat() {
        try {
            val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

            val hb = mapOf(
                "device_id" to BuildConfig.DEVICE_ID,
                "status" to "active",
                "last_signal" to now,
                "timestamp" to now
            )

            val body = gson.toJson(hb).toRequestBody(JSON_TYPE)
            val request = supabaseRequest("collector_heartbeats")
                .post(body)
                .build()

            client.newCall(request).execute().close()
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

            // signal_time 기준 ±2시간 범위 계산
            val signalOdt = OffsetDateTime.parse(s.signalTime)
            val rangeStart = signalOdt.minusHours(2)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            val rangeEnd = signalOdt.plusHours(2)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

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
