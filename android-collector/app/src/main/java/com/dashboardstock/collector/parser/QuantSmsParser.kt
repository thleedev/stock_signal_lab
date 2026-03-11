package com.dashboardstock.collector.parser

import com.dashboardstock.collector.api.SignalInput
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 퀀트 SMS 파서
 *
 * [매수예고] 예시:
 * [키움]퀀트 - 매수예고신호
 * ◆성장추구 ============
 * ◇KG케미칼(001390)
 *  - AI상승확률89.29/주가매력도99.96
 *  - 성장성57.3/안정성74.3/수익성61.3
 *
 * [매도완료] 예시:
 * [키움]퀀트 - 매도완료
 * ◆성장추구 ============
 * ◇삼지전자(037460)
 *  - 매도가 19,310원
 *  - 수익률 -12.43%
 */
object QuantSmsParser {

    private val BUY_FORECAST_PATTERN = Regex("\\[키움\\]\\s*퀀트\\s*-\\s*매수예고")
    private val BUY_COMPLETE_PATTERN = Regex("\\[키움\\]\\s*퀀트\\s*-\\s*매수완료")
    private val SELL_COMPLETE_PATTERN = Regex("\\[키움\\]\\s*퀀트\\s*-\\s*매도완료")

    // 전략 그룹
    private val STRATEGY_GROUP_PATTERN = Regex("[◆●■◇○□](성장추구|가치추구|시장추종)")

    // 종목: ◇종목명(종목코드)
    private val STOCK_PATTERN = Regex("◇(.+?)\\((\\d{6})\\)")

    // 매수예고 데이터
    private val AI_PROB_PATTERN = Regex("AI상승확률([0-9.]+)/주가매력도([0-9.]+)")
    private val SCORES_PATTERN = Regex("성장성([0-9.]+)/안정성([0-9.]+)/수익성([0-9.]+)")
    private val THEME_PATTERN = Regex("-\\s*(.+테마.+)")

    // 매수완료 데이터
    private val BUY_PRICE_PATTERN = Regex("매수가\\s*([0-9,]+)원")
    private val STOP_LOSS_PATTERN = Regex("손절가\\s*([0-9,]+)원")

    // 매도완료 데이터
    private val SELL_PRICE_PATTERN = Regex("매도가\\s*([0-9,]+)원")
    private val RETURN_PATTERN = Regex("수익률\\s*([+-]?[0-9.]+)%")

    fun canParse(sender: String, body: String): Boolean {
        return BUY_FORECAST_PATTERN.containsMatchIn(body) ||
                BUY_COMPLETE_PATTERN.containsMatchIn(body) ||
                SELL_COMPLETE_PATTERN.containsMatchIn(body)
    }

    fun parse(body: String): List<SignalInput> {
        return when {
            BUY_FORECAST_PATTERN.containsMatchIn(body) -> parseBuyForecast(body)
            BUY_COMPLETE_PATTERN.containsMatchIn(body) -> parseBuyComplete(body)
            else -> parseSellComplete(body)
        }
    }

    private fun parseBuyForecast(body: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        // 전략그룹별 블록 분리: "◆성장추구" ~ 다음 "◆" 또는 끝까지
        val blocks = splitByStrategyGroup(body)

        return blocks.flatMap { (group, block) ->
            STOCK_PATTERN.findAll(block).map { match ->
                val name = match.groupValues[1].trim()
                val symbol = match.groupValues[2]

                val rawData = mutableMapOf<String, Any?>(
                    "strategy_group" to group
                )

                AI_PROB_PATTERN.find(block)?.let {
                    rawData["ai_rise_prob"] = it.groupValues[1].toDouble()
                    rawData["price_attractiveness"] = it.groupValues[2].toDouble()
                }
                SCORES_PATTERN.find(block)?.let {
                    rawData["growth_score"] = it.groupValues[1].toDouble()
                    rawData["stability_score"] = it.groupValues[2].toDouble()
                    rawData["profitability_score"] = it.groupValues[3].toDouble()
                }
                THEME_PATTERN.find(block)?.let {
                    rawData["theme_info"] = it.groupValues[1].trim()
                }

                SignalInput(
                    timestamp = timestamp,
                    symbol = symbol,
                    name = name,
                    signalType = "BUY_FORECAST",
                    source = "quant",
                    rawData = rawData
                )
            }.toList()
        }
    }

    private fun parseBuyComplete(body: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        val blocks = splitByStrategyGroup(body)

        return blocks.flatMap { (group, block) ->
            STOCK_PATTERN.findAll(block).map { match ->
                val name = match.groupValues[1].trim()
                val symbol = match.groupValues[2]

                // 종목 뒤의 텍스트에서 매수가/손절가 추출
                val afterStock = block.substring(match.range.last + 1)
                val buyPrice = BUY_PRICE_PATTERN.find(afterStock)?.groupValues?.get(1)
                    ?.replace(",", "")?.toIntOrNull()
                val stopLoss = STOP_LOSS_PATTERN.find(afterStock)?.groupValues?.get(1)
                    ?.replace(",", "")?.toIntOrNull()

                val rawData = mutableMapOf<String, Any?>(
                    "strategy_group" to group
                )
                buyPrice?.let { rawData["buy_price"] = it }
                stopLoss?.let { rawData["stop_loss_price"] = it }

                SignalInput(
                    timestamp = timestamp,
                    symbol = symbol,
                    name = name,
                    signalType = "BUY",
                    signalPrice = buyPrice,
                    source = "quant",
                    rawData = rawData
                )
            }.toList()
        }
    }

    private fun parseSellComplete(body: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        val blocks = splitByStrategyGroup(body)

        return blocks.flatMap { (group, block) ->
            STOCK_PATTERN.findAll(block).map { match ->
                val name = match.groupValues[1].trim()
                val symbol = match.groupValues[2]

                val sellPrice = SELL_PRICE_PATTERN.find(block)?.groupValues?.get(1)
                    ?.replace(",", "")?.toIntOrNull()
                val returnPct = RETURN_PATTERN.find(block)?.groupValues?.get(1)?.toDoubleOrNull()

                val rawData = mutableMapOf<String, Any?>(
                    "strategy_group" to group
                )
                sellPrice?.let { rawData["sell_price"] = it }
                returnPct?.let { rawData["return_pct"] = it }

                SignalInput(
                    timestamp = timestamp,
                    symbol = symbol,
                    name = name,
                    signalType = "SELL_COMPLETE",
                    signalPrice = sellPrice,
                    source = "quant",
                    rawData = rawData
                )
            }.toList()
        }
    }

    /** "◆전략그룹" 기준으로 텍스트 블록 분리 */
    private fun splitByStrategyGroup(body: String): List<Pair<String, String>> {
        val results = mutableListOf<Pair<String, String>>()
        val groupMatches = STRATEGY_GROUP_PATTERN.findAll(body).toList()

        for (i in groupMatches.indices) {
            val group = groupMatches[i].groupValues[1]
            val start = groupMatches[i].range.first
            val end = if (i + 1 < groupMatches.size) groupMatches[i + 1].range.first else body.length
            results.add(group to body.substring(start, end))
        }

        return results
    }
}
