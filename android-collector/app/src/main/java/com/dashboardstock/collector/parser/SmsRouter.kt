package com.dashboardstock.collector.parser

import com.dashboardstock.collector.api.SignalInput

/**
 * SMS 본문을 분석하여 적절한 파서로 라우팅
 */
object SmsRouter {

    enum class Source { LASSI, STOCKBOT, QUANT, UNKNOWN }

    fun identify(sender: String, body: String): Source {
        return when {
            StockbotSmsParser.canParse(sender, body) -> Source.STOCKBOT
            QuantSmsParser.canParse(sender, body) -> Source.QUANT
            LassiSmsParser.canParse(sender, body) -> Source.LASSI
            else -> Source.UNKNOWN
        }
    }

    fun parse(sender: String, body: String): List<SignalInput> {
        return when (identify(sender, body)) {
            Source.LASSI -> LassiSmsParser.parse(body)
            Source.STOCKBOT -> StockbotSmsParser.parse(body)
            Source.QUANT -> QuantSmsParser.parse(body)
            Source.UNKNOWN -> emptyList()
        }
    }
}
