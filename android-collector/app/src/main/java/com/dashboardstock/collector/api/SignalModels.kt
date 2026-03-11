package com.dashboardstock.collector.api

import com.google.gson.annotations.SerializedName

/** 파서 출력용 신호 데이터 */
data class SignalInput(
    val timestamp: String,
    val symbol: String? = null,
    val name: String,
    @SerializedName("signal_type") val signalType: String,
    @SerializedName("signal_price") val signalPrice: Int? = null,
    val source: String,
    @SerializedName("time_group") val timeGroup: String? = null,
    @SerializedName("is_fallback") val isFallback: Boolean = false,
    @SerializedName("raw_data") val rawData: Map<String, Any?>? = null
)
