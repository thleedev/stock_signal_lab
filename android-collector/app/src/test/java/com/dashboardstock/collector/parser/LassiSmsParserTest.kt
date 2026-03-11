package com.dashboardstock.collector.parser

import org.junit.Assert.*
import org.junit.Test

class LassiSmsParserTest {

    private val sampleSms = """
[키움][라씨매매신호] 주요 종목신호

오늘 시장의 주목을 받고 있는 종목들의 신호 상태를 확인해 보세요.

펄어비스(263750) 보유중, 한화시스템(272210) 오늘 매도, 한화에어로스페이스(012450) 보유중
    """.trimIndent()

    @Test
    fun `canParse detects lassi SMS`() {
        assertTrue(LassiSmsParser.canParse("15449300", sampleSms))
    }

    @Test
    fun `parse extracts three stocks`() {
        val signals = LassiSmsParser.parse(sampleSms)
        assertEquals(3, signals.size)
    }

    @Test
    fun `parse extracts stock details`() {
        val signals = LassiSmsParser.parse(sampleSms)

        assertEquals("펄어비스", signals[0].name)
        assertEquals("263750", signals[0].symbol)
        assertEquals("HOLD", signals[0].signalType)

        assertEquals("한화시스템", signals[1].name)
        assertEquals("272210", signals[1].symbol)
        assertEquals("SELL", signals[1].signalType)

        assertEquals("한화에어로스페이스", signals[2].name)
        assertEquals("012450", signals[2].symbol)
        assertEquals("HOLD", signals[2].signalType)
    }

    @Test
    fun `parse sets fallback flag`() {
        val signals = LassiSmsParser.parse(sampleSms)
        assertTrue(signals.all { it.isFallback })
    }

    @Test
    fun `parse returns empty for non-signal SMS`() {
        val signals = LassiSmsParser.parse("일반 문자 메시지입니다")
        assertTrue(signals.isEmpty())
    }
}
