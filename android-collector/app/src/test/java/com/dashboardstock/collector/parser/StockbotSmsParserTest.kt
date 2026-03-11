package com.dashboardstock.collector.parser

import org.junit.Assert.*
import org.junit.Test

class StockbotSmsParserTest {

    private val sampleSms = """
[키움] 스톡봇 추천주

▷ 종목명: 하나마이크론
- 기업 개요: 반도체 패키징 및 테스트 사업자..업황 회복 및 증설 효과에 따른 실적 성장세 관심
- 투자포인트: 실적 고성장+외국인&기관 동반 매수
- 추천가: 34,500원
(매수가 범위: 33,900원 ~ 35,000원)
- 목표가: 38,700원
- 손절가: 31,700원
    """.trimIndent()

    @Test
    fun `canParse detects stockbot SMS`() {
        assertTrue(StockbotSmsParser.canParse("15449300", sampleSms))
    }

    @Test
    fun `canParse rejects non-stockbot SMS`() {
        assertFalse(StockbotSmsParser.canParse("15449300", "일반 문자 메시지"))
    }

    @Test
    fun `parse extracts stock name`() {
        val signals = StockbotSmsParser.parse(sampleSms)
        assertEquals(1, signals.size)
        assertEquals("하나마이크론", signals[0].name)
    }

    @Test
    fun `parse extracts all prices`() {
        val signals = StockbotSmsParser.parse(sampleSms)
        val raw = signals[0].rawData!!

        assertEquals(34500, raw["recommend_price"])
        assertEquals(33900, raw["buy_range_low"])
        assertEquals(35000, raw["buy_range_high"])
        assertEquals(38700, raw["target_price"])
        assertEquals(31700, raw["stop_loss_price"])
    }

    @Test
    fun `parse sets signal type BUY`() {
        val signals = StockbotSmsParser.parse(sampleSms)
        assertEquals("BUY", signals[0].signalType)
        assertEquals("stockbot", signals[0].source)
    }

    @Test
    fun `parse extracts investment point`() {
        val signals = StockbotSmsParser.parse(sampleSms)
        assertEquals("실적 고성장+외국인&기관 동반 매수", signals[0].rawData!!["investment_point"])
    }
}
