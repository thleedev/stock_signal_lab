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
                source = s.source,
                batchId = batchId,
                isFallback = s.isFallback,
                rawData = buildRawData(s),
                deviceId = BuildConfig.DEVICE_ID
            )
        }

        // symbol이 있는 것 → upsert (같은 종목+소스면 상태/시간/가격만 업데이트)
        // symbol이 없는 것 → 일반 insert
        val (withSymbol, withoutSymbol) = rows.partition { it.symbol != null }

        if (withSymbol.isNotEmpty()) {
            val body = gson.toJson(withSymbol).toRequestBody(JSON_TYPE)
            // on_conflict: symbol+source 조합이 같으면 업데이트
            val request = supabaseRequest("signals?on_conflict=symbol,source")
                .header("Prefer", "return=minimal,resolution=merge-duplicates")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                val errorBody = response.body?.string() ?: "unknown error"
                response.close()
                throw RuntimeException("Supabase upsert failed (${response.code}): $errorBody")
            }
            response.close()
            Log.i(TAG, "Upserted ${withSymbol.size} signals (with symbol)")
        }

        if (withoutSymbol.isNotEmpty()) {
            val body = gson.toJson(withoutSymbol).toRequestBody(JSON_TYPE)
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
            Log.i(TAG, "Inserted ${withoutSymbol.size} signals (no symbol)")
        }

        Log.i(TAG, "Sent OK: ${signals.size} signals total")

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
    val source: String,
    @SerializedName("batch_id") val batchId: String,
    @SerializedName("is_fallback") val isFallback: Boolean,
    @SerializedName("raw_data") val rawData: Map<String, Any?>?,
    @SerializedName("device_id") val deviceId: String
)
