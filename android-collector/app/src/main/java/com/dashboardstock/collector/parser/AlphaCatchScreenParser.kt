package com.dashboardstock.collector.parser

import android.graphics.Rect
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.dashboardstock.collector.api.AlphaCatchHoldingInput
import com.dashboardstock.collector.api.SignalInput
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 영웅문 알파캐치 → 알파추천 → 매매 신호 탭 화면 파서
 *
 * 화면 구성 (세로 스크롤):
 *   [매수 신호] 종목명 / 섹터 / 매수가
 *   [매도 신호] 종목명 / 수익률 / 매도가
 *   [보유 종목] 종목명 / 수익률 / 종가 / 매수가 / 매수일
 *
 * 라씨와 달리 한 화면에 3섹션이 세로로 쌓여있어 스크롤하며 누적 수집.
 */
object AlphaCatchScreenParser {

    private const val TAG = "AlphaCatchParser"

    private val PRICE_PATTERN = Regex("""^[0-9]{1,3}(,[0-9]{3})*$""")
    private val PERCENT_PATTERN = Regex("""^([+-]?[0-9]+(\.[0-9]+)?)%$""")
    private val DATE_PATTERN = Regex("""^[0-9]{2}\.[0-9]{2}$""")
    private val SYMBOL_PATTERN = Regex("""^\d{6}$""")

    private const val SECTION_BUY = "매수 신호"
    private const val SECTION_SELL = "매도 신호"
    private const val SECTION_HOLDING = "보유 종목"

    /** Y좌표 기준으로 정렬된 텍스트 노드 */
    private data class PositionedText(val text: String, val y: Int, val x: Int)

    /** 파싱 결과 */
    data class ParseResult(
        val buySignals: List<SignalInput>,
        val sellSignals: List<SignalInput>,
        val holdings: List<AlphaCatchHoldingInput>
    )

    fun parseVisibleNodes(root: AccessibilityNodeInfo): ParseResult {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        val nodes = mutableListOf<PositionedText>()
        collectPositionedText(root, nodes)
        // Y, X 순으로 정렬 (위→아래, 같은 줄이면 왼→오른)
        nodes.sortWith(compareBy({ it.y }, { it.x }))

        // 섹션 헤더 위치
        val buyIdx = nodes.indexOfFirst { it.text == SECTION_BUY }
        val sellIdx = nodes.indexOfFirst { it.text == SECTION_SELL }
        val holdingIdx = nodes.indexOfFirst { it.text == SECTION_HOLDING }

        val buyEnd = listOf(sellIdx, holdingIdx, nodes.size).filter { it > buyIdx }.minOrNull() ?: nodes.size
        val sellEnd = listOf(holdingIdx, nodes.size).filter { it > sellIdx }.minOrNull() ?: nodes.size

        val buyTexts = if (buyIdx >= 0) nodes.subList(buyIdx + 1, buyEnd).map { it.text } else emptyList()
        val sellTexts = if (sellIdx >= 0) nodes.subList(sellIdx + 1, sellEnd).map { it.text } else emptyList()
        val holdingTexts = if (holdingIdx >= 0) nodes.subList(holdingIdx + 1, nodes.size).map { it.text } else emptyList()

        val buys = parseBuyRows(buyTexts, timestamp)
        val sells = parseSellRows(sellTexts, timestamp)
        val holdings = parseHoldingRows(holdingTexts)

        Log.d(TAG, "Parsed: buy=${buys.size}, sell=${sells.size}, hold=${holdings.size}")
        return ParseResult(buys, sells, holdings)
    }

    /**
     * 매수 신호 행: 종목명(한글) / 섹터(한글, 공백 가능) / 매수가(숫자,원)
     * 헤더 텍스트("종목명","섹터","매수가") 스킵.
     * 행 종료 신호: 다음 종목명 또는 다음 섹션 헤더.
     */
    private fun parseBuyRows(texts: List<String>, timestamp: String): List<SignalInput> {
        val result = mutableListOf<SignalInput>()
        val cleaned = texts.filter { it !in listOf("종목명", "섹터", "매수가", "수익률", "매도가") }
        var i = 0
        while (i < cleaned.size) {
            val name = cleaned[i]
            if (!isStockName(name)) { i++; continue }
            // 다음 가격(숫자) 직전까지 이어진 텍스트를 섹터로 합침
            var j = i + 1
            val sectorParts = mutableListOf<String>()
            var price: Int? = null
            while (j < cleaned.size) {
                val t = cleaned[j]
                if (PRICE_PATTERN.matches(t)) {
                    price = t.replace(",", "").toIntOrNull()
                    j++
                    break
                }
                if (isStockName(t) && sectorParts.isNotEmpty()) break
                sectorParts.add(t)
                j++
            }
            if (price == null) { i++; continue }
            val sector = sectorParts.joinToString(" ").trim()
            result.add(
                SignalInput(
                    timestamp = timestamp, symbol = null, name = name,
                    signalType = "BUY", signalPrice = price,
                    source = "quant",
                    rawData = mapOf("sector" to sector)
                )
            )
            i = j
        }
        return result
    }

    /** 매도 신호 행: 종목명 / 수익률(%) / 매도가 */
    private fun parseSellRows(texts: List<String>, timestamp: String): List<SignalInput> {
        val result = mutableListOf<SignalInput>()
        val cleaned = texts.filter { it !in listOf("종목명", "수익률", "매도가") }
        var i = 0
        while (i < cleaned.size) {
            val name = cleaned[i]
            if (!isStockName(name)) { i++; continue }
            val pctText = cleaned.getOrNull(i + 1) ?: break
            val priceText = cleaned.getOrNull(i + 2) ?: break
            val pctMatch = PERCENT_PATTERN.matchEntire(pctText)
            val price = if (PRICE_PATTERN.matches(priceText)) priceText.replace(",", "").toIntOrNull() else null
            if (pctMatch == null || price == null) { i++; continue }
            val returnPct = pctMatch.groupValues[1].toDoubleOrNull()
            result.add(
                SignalInput(
                    timestamp = timestamp, symbol = null, name = name,
                    signalType = "SELL_COMPLETE", signalPrice = price,
                    source = "quant",
                    rawData = mapOf("return_pct" to returnPct)
                )
            )
            i += 3
        }
        return result
    }

    /** 보유 종목 행: 종목명 / 수익률 / 종가 / 매수가 / 매수일(MM.DD) */
    private fun parseHoldingRows(texts: List<String>): List<AlphaCatchHoldingInput> {
        val result = mutableListOf<AlphaCatchHoldingInput>()
        val headerWords = setOf("종목명", "수익률", "종가", "매수가", "매수일")
        val cleaned = texts.filter { it !in headerWords }
        var i = 0
        while (i < cleaned.size) {
            val name = cleaned[i]
            if (!isStockName(name)) { i++; continue }
            val pct = cleaned.getOrNull(i + 1)?.let { PERCENT_PATTERN.matchEntire(it)?.groupValues?.get(1)?.toDoubleOrNull() }
            val close = cleaned.getOrNull(i + 2)?.takeIf { PRICE_PATTERN.matches(it) }?.replace(",", "")?.toIntOrNull()
            val avgBuy = cleaned.getOrNull(i + 3)?.takeIf { PRICE_PATTERN.matches(it) }?.replace(",", "")?.toIntOrNull()
            val date = cleaned.getOrNull(i + 4)?.takeIf { DATE_PATTERN.matches(it) }?.let { mmdd ->
                // MM.DD → YYYY-MM-DD (현재 연도 기준)
                val (mm, dd) = mmdd.split(".")
                val year = OffsetDateTime.now(ZoneId.of("Asia/Seoul")).year
                "%04d-%s-%s".format(year, mm, dd)
            }
            if (pct == null && close == null) { i++; continue }
            result.add(
                AlphaCatchHoldingInput(
                    symbol = "", // 화면에 종목코드 미노출 → 서버 측 보강 필요. 임시로 빈 문자열.
                    name = name,
                    returnPct = pct,
                    closePrice = close,
                    avgBuyPrice = avgBuy,
                    boughtAt = date
                )
            )
            i += 5
        }
        return result
    }

    private fun isStockName(text: String): Boolean {
        if (text.isBlank() || text.length > 25) return false
        if (PRICE_PATTERN.matches(text)) return false
        if (PERCENT_PATTERN.matches(text)) return false
        if (DATE_PATTERN.matches(text)) return false
        if (SYMBOL_PATTERN.matches(text)) return false
        // 한글이 1자라도 포함된 텍스트만 종목명 후보
        return text.any { it in '가'..'힣' }
    }

    private fun collectPositionedText(node: AccessibilityNodeInfo, result: MutableList<PositionedText>) {
        val text = node.text?.toString()?.trim()
        if (!text.isNullOrEmpty()) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            result.add(PositionedText(text, rect.top, rect.left))
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectPositionedText(child, result)
            child.recycle()
        }
    }
}
