package com.dashboardstock.collector.api

import com.google.gson.annotations.SerializedName

/** 알파캐치 보유 종목 (영웅문 알파추천 → 보유종목 탭) */
data class AlphaCatchHoldingInput(
    val symbol: String,
    val name: String,
    @SerializedName("return_pct") val returnPct: Double? = null,
    @SerializedName("close_price") val closePrice: Int? = null,
    @SerializedName("avg_buy_price") val avgBuyPrice: Int? = null,
    @SerializedName("bought_at") val boughtAt: String? = null
)
