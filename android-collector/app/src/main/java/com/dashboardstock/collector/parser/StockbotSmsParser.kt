package com.dashboardstock.collector.parser

import com.dashboardstock.collector.api.SignalInput
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 스톡봇 SMS 파서
 *
 * SMS 예시:
 * [키움] 스톡봇 추천주
 * ▷ 종목명: 하나마이크론
 * - 기업 개요: 반도체 패키징 및 테스트 사업자...
 * - 투자포인트: 실적 고성장+외국인&기관 동반 매수
 * - 추천가: 34,500원
 * (매수가 범위: 33,900원 ~ 35,000원)
 * - 목표가: 38,700원
 * - 손절가: 31,700원
 */
object StockbotSmsParser {

    private val SENDER_PATTERN = Regex("\\[키움\\]\\s*스톡봇")

    private val NAME_PATTERN = Regex("▷\\s*종목명:\\s*(.+)")
    private val RECOMMEND_PRICE_PATTERN = Regex("추천가:\\s*([0-9,]+)원")
    private val BUY_RANGE_PATTERN = Regex("매수가\\s*범위:\\s*([0-9,]+)원\\s*~\\s*([0-9,]+)원")
    private val TARGET_PRICE_PATTERN = Regex("목표가:\\s*([0-9,]+)원")
    private val STOP_LOSS_PATTERN = Regex("손절가:\\s*([0-9,]+)원")
    private val INVEST_POINT_PATTERN = Regex("투자포인트:\\s*(.+)")
    private val OVERVIEW_PATTERN = Regex("기업\\s*개요:\\s*(.+)")

    fun canParse(sender: String, body: String): Boolean {
        return SENDER_PATTERN.containsMatchIn(body)
    }

    fun parse(body: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        val name = NAME_PATTERN.find(body)?.groupValues?.get(1)?.trim() ?: return emptyList()
        val recommendPrice = extractPrice(RECOMMEND_PRICE_PATTERN, body)
        val buyRangeLow = BUY_RANGE_PATTERN.find(body)?.groupValues?.get(1)?.let { parsePrice(it) }
        val buyRangeHigh = BUY_RANGE_PATTERN.find(body)?.groupValues?.get(2)?.let { parsePrice(it) }
        val targetPrice = extractPrice(TARGET_PRICE_PATTERN, body)
        val stopLoss = extractPrice(STOP_LOSS_PATTERN, body)
        val investPoint = INVEST_POINT_PATTERN.find(body)?.groupValues?.get(1)?.trim()
        val overview = OVERVIEW_PATTERN.find(body)?.groupValues?.get(1)?.trim()

        val rawData = mutableMapOf<String, Any?>()
        recommendPrice?.let { rawData["recommend_price"] = it }
        buyRangeLow?.let { rawData["buy_range_low"] = it }
        buyRangeHigh?.let { rawData["buy_range_high"] = it }
        targetPrice?.let { rawData["target_price"] = it }
        stopLoss?.let { rawData["stop_loss_price"] = it }
        investPoint?.let { rawData["investment_point"] = it }
        overview?.let { rawData["company_overview"] = it }

        return listOf(
            SignalInput(
                timestamp = timestamp,
                name = name,
                signalType = "BUY",
                signalPrice = recommendPrice,
                source = "stockbot",
                rawData = rawData
            )
        )
    }

    private fun extractPrice(pattern: Regex, text: String): Int? {
        return pattern.find(text)?.groupValues?.get(1)?.let { parsePrice(it) }
    }

    private fun parsePrice(priceStr: String): Int {
        return priceStr.replace(",", "").toInt()
    }
}
