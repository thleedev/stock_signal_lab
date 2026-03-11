package com.dashboardstock.collector.parser

import org.junit.Assert.*
import org.junit.Test

class QuantSmsParserTest {

    private val buyForecastSms = """
[키움]퀀트 - 매수예고신호
*15시 주가로 매수할 예정

◆성장추구 ============
◇KG케미칼(001390)
 - AI상승확률89.29/주가매력도99.96
 - 성장성57.3/안정성74.3/수익성61.3
 - (03/06)2차전지(소재/부품) 테마 평균 +3.22% 상승

◆가치추구 ============
◇경방(000050)
 - AI상승확률90.08/주가매력도94.74
 - 성장성65.6/안정성66.7/수익성73.8
 - 섬유사업 영위 및 복합쇼핑몰 운영 업체
    """.trimIndent()

    private val sellCompleteSms = """
[키움]퀀트 - 매도완료

◆성장추구 ============
◇삼지전자(037460)
 - 매도가 19,310원
 - 수익률 -12.43%

◆가치추구 ============
◇SK(034730)
 - 매도가 324,000원
 - 수익률 -11.6%
    """.trimIndent()

    @Test
    fun `canParse detects buy forecast`() {
        assertTrue(QuantSmsParser.canParse("15449300", buyForecastSms))
    }

    @Test
    fun `canParse detects sell complete`() {
        assertTrue(QuantSmsParser.canParse("15449300", sellCompleteSms))
    }

    @Test
    fun `parse buy forecast extracts two stocks`() {
        val signals = QuantSmsParser.parse(buyForecastSms)
        assertEquals(2, signals.size)

        assertEquals("KG케미칼", signals[0].name)
        assertEquals("001390", signals[0].symbol)
        assertEquals("BUY_FORECAST", signals[0].signalType)

        assertEquals("경방", signals[1].name)
        assertEquals("000050", signals[1].symbol)
    }

    @Test
    fun `parse buy forecast extracts AI probabilities`() {
        val signals = QuantSmsParser.parse(buyForecastSms)
        val raw = signals[0].rawData!!

        assertEquals("성장추구", raw["strategy_group"])
        assertEquals(89.29, raw["ai_rise_prob"])
        assertEquals(99.96, raw["price_attractiveness"])
        assertEquals(57.3, raw["growth_score"])
        assertEquals(74.3, raw["stability_score"])
        assertEquals(61.3, raw["profitability_score"])
    }

    @Test
    fun `parse sell complete extracts price and return`() {
        val signals = QuantSmsParser.parse(sellCompleteSms)
        assertEquals(2, signals.size)

        assertEquals("삼지전자", signals[0].name)
        assertEquals("037460", signals[0].symbol)
        assertEquals("SELL_COMPLETE", signals[0].signalType)
        assertEquals(19310, signals[0].signalPrice)
        assertEquals("성장추구", signals[0].rawData!!["strategy_group"])
        assertEquals(-12.43, signals[0].rawData!!["return_pct"])
    }

    @Test
    fun `parse sell complete second stock`() {
        val signals = QuantSmsParser.parse(sellCompleteSms)

        assertEquals("SK", signals[1].name)
        assertEquals("034730", signals[1].symbol)
        assertEquals(324000, signals[1].signalPrice)
        assertEquals("가치추구", signals[1].rawData!!["strategy_group"])
    }
}
