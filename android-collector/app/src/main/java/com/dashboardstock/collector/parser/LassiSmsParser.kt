package com.dashboardstock.collector.parser

import com.dashboardstock.collector.api.SignalInput
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 라씨매매신호 SMS 폴백 파서
 *
 * SMS 예시:
 * "펄어비스(263750) 보유중, 한화시스템(272210) 오늘 매도, 한화에어로스페이스(012450) 보유중"
 *
 * 제한: 가격 정보 없음, 상태(보유중/매도)만 추출 가능
 */
object LassiSmsParser {

    private val SENDER_PATTERN = Regex("\\[키움\\]\\[라씨매매신호\\]|\\[라씨매매신호\\]")

    // "종목명(종목코드) 상태" 패턴
    private val STOCK_PATTERN = Regex(
        """([가-힣A-Za-z0-9\s]+?)\((\d{6})\)\s*(보유중|오늘\s*매도|오늘\s*매수|매도|매수)"""
    )

    fun canParse(sender: String, body: String): Boolean {
        return SENDER_PATTERN.containsMatchIn(body)
    }

    fun parse(body: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        return STOCK_PATTERN.findAll(body).map { match ->
            val name = match.groupValues[1].trim()
            val symbol = match.groupValues[2]
            val status = match.groupValues[3].replace("\\s+".toRegex(), "")

            val signalType = when {
                status.contains("매도") -> "SELL"
                status.contains("매수") -> "BUY"
                status.contains("보유중") -> "HOLD"
                else -> "HOLD"
            }

            SignalInput(
                timestamp = timestamp,
                symbol = symbol,
                name = name,
                signalType = signalType,
                signalPrice = null, // SMS에는 가격 정보 없음
                source = "lassi",
                isFallback = true
            )
        }.toList()
    }
}
