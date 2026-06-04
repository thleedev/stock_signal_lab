package com.dashboardstock.collector.parser

import com.dashboardstock.collector.api.SignalInput
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 알파캐치 SMS 파서 ([키움][알파캐치] 헤더)
 *
 * 매수/매도 SMS 모두 동일한 포맷으로 옴 (▶ 매수 / ▶ 매도 만 다름).
 * source = "quant" (옵션 A: 라벨만 알파캐치, 내부 식별자는 그대로 유지)
 *
 * 예시:
 * [키움][알파캐치] 2026.04.30 매매신호
 *
 * ▶ 매수
 * 1)종목명: 제일기획(030000)
 * 종목정보:
 * - 알파스코어 100.00
 * - 코스피 일반서비스
 * - 변동성 낮음
 * 진입구간: 19,200 ~ 20,800원
 * 단기 목표가: 22,000원
 */
object AlphaCatchSmsParser {

    private val HEADER_PATTERN = Regex("\\[키움\\]\\s*\\[알파캐치\\]")
    private val SECTION_PATTERN = Regex("▶\\s*(매수|매도)")
    private val STOCK_PATTERN = Regex("\\d+\\)\\s*종목명:\\s*(.+?)\\((\\d{6})\\)")
    private val ALPHA_SCORE_PATTERN = Regex("알파스코어\\s*([0-9.]+)")
    private val VOLATILITY_PATTERN = Regex("변동성\\s*(낮음|보통|높음)")
    private val ENTRY_RANGE_PATTERN = Regex("진입구간:\\s*([0-9,]+)\\s*~\\s*([0-9,]+)\\s*원")
    private val TARGET_PRICE_PATTERN = Regex("단기\\s*목표가:\\s*([0-9,]+)\\s*원")

    fun canParse(sender: String, body: String): Boolean {
        return HEADER_PATTERN.containsMatchIn(body)
    }

    fun parse(body: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        return splitBySection(body).flatMap { (section, block) ->
            val signalType = if (section == "매수") "BUY" else "SELL_COMPLETE"
            STOCK_PATTERN.findAll(block).map { match ->
                val name = match.groupValues[1].trim()
                val symbol = match.groupValues[2]
                val afterStock = block.substring(match.range.last + 1)

                val rawData = mutableMapOf<String, Any?>()
                ALPHA_SCORE_PATTERN.find(afterStock)?.let {
                    rawData["alpha_score"] = it.groupValues[1].toDoubleOrNull()
                }
                extractSector(afterStock)?.let { rawData["sector"] = it }
                VOLATILITY_PATTERN.find(afterStock)?.let {
                    rawData["volatility"] = it.groupValues[1]
                }
                ENTRY_RANGE_PATTERN.find(afterStock)?.let {
                    rawData["entry_low"] = it.groupValues[1].replace(",", "").toIntOrNull()
                    rawData["entry_high"] = it.groupValues[2].replace(",", "").toIntOrNull()
                }
                TARGET_PRICE_PATTERN.find(afterStock)?.let {
                    rawData["target_price"] = it.groupValues[1].replace(",", "").toIntOrNull()
                }

                // signal_price: 매수는 entry_low, 매도는 target_price (있으면)
                val signalPrice = when (signalType) {
                    "BUY" -> rawData["entry_low"] as? Int
                    else -> rawData["target_price"] as? Int
                }

                SignalInput(
                    timestamp = timestamp,
                    symbol = symbol,
                    name = name,
                    signalType = signalType,
                    signalPrice = signalPrice,
                    source = "quant",
                    rawData = rawData
                )
            }.toList()
        }
    }

    /** "▶ 매수" / "▶ 매도" 기준으로 블록 분리 */
    private fun splitBySection(body: String): List<Pair<String, String>> {
        val matches = SECTION_PATTERN.findAll(body).toList()
        if (matches.isEmpty()) return emptyList()
        return matches.mapIndexed { i, m ->
            val section = m.groupValues[1]
            val start = m.range.first
            val end = if (i + 1 < matches.size) matches[i + 1].range.first else body.length
            section to body.substring(start, end)
        }
    }

    /**
     * 섹터 추출: 종목정보 블록의 두 번째 "- " 라인이 섹터.
     * 알파스코어/변동성 라인은 별도 정규식이 처리하므로 제외.
     */
    private fun extractSector(block: String): String? {
        val sectorLine = block.lineSequence()
            .map { it.trim() }
            .filter { it.startsWith("- ") }
            .map { it.removePrefix("- ").trim() }
            .firstOrNull { line ->
                !line.startsWith("알파스코어") && !line.startsWith("변동성")
            }
        return sectorLine?.takeIf { it.isNotBlank() }
    }
}
