package com.dashboardstock.collector.parser

import org.junit.Assert.*
import org.junit.Test

class AlphaCatchSmsParserTest {

    private val buySms = """
[키움][알파캐치] 2026.04.30 매매신호

▶ 매수
1)종목명: 제일기획(030000)
종목정보:
- 알파스코어 100.00
- 코스피 일반서비스
- 변동성 낮음
진입구간: 19,200 ~ 20,800원
단기 목표가: 22,000원
    """.trimIndent()

    private val sellSms = """
[키움][알파캐치] 2026.04.30 매매신호

▶ 매도
1)종목명: 네오셈(253590)
종목정보:
- 알파스코어 85.50
- 코스닥 반도체
- 변동성 보통
진입구간: 18,000 ~ 19,500원
단기 목표가: 21,000원
    """.trimIndent()

    @Test
    fun `canParse detects 알파캐치 header`() {
        assertTrue(AlphaCatchSmsParser.canParse("", buySms))
        assertTrue(AlphaCatchSmsParser.canParse("", sellSms))
        assertFalse(AlphaCatchSmsParser.canParse("", "[키움]퀀트 - 매수예고신호"))
    }

    @Test
    fun `parses BUY signal with all fields`() {
        val signals = AlphaCatchSmsParser.parse(buySms)
        assertEquals(1, signals.size)
        val s = signals[0]
        assertEquals("030000", s.symbol)
        assertEquals("제일기획", s.name)
        assertEquals("BUY", s.signalType)
        assertEquals("quant", s.source)
        assertEquals(19200, s.signalPrice)

        val raw = s.rawData!!
        assertEquals(100.00, raw["alpha_score"])
        assertEquals("코스피 일반서비스", raw["sector"])
        assertEquals("낮음", raw["volatility"])
        assertEquals(19200, raw["entry_low"])
        assertEquals(20800, raw["entry_high"])
        assertEquals(22000, raw["target_price"])
    }

    @Test
    fun `parses SELL signal as SELL_COMPLETE`() {
        val signals = AlphaCatchSmsParser.parse(sellSms)
        assertEquals(1, signals.size)
        val s = signals[0]
        assertEquals("253590", s.symbol)
        assertEquals("네오셈", s.name)
        assertEquals("SELL_COMPLETE", s.signalType)
        assertEquals("코스닥 반도체", s.rawData!!["sector"])
        assertEquals("보통", s.rawData!!["volatility"])
    }

    @Test
    fun `parses multiple stocks across sections`() {
        val multi = """
[키움][알파캐치] 2026.04.30 매매신호

▶ 매수
1)종목명: 제일기획(030000)
종목정보:
- 알파스코어 100.00
- 코스피 일반서비스
- 변동성 낮음
진입구간: 19,200 ~ 20,800원
단기 목표가: 22,000원

▶ 매도
1)종목명: 네오셈(253590)
종목정보:
- 알파스코어 85.50
- 코스닥 반도체
- 변동성 보통
진입구간: 18,000 ~ 19,500원
단기 목표가: 21,000원
        """.trimIndent()

        val signals = AlphaCatchSmsParser.parse(multi)
        assertEquals(2, signals.size)
        assertEquals("BUY", signals[0].signalType)
        assertEquals("SELL_COMPLETE", signals[1].signalType)
    }
}
