package com.dashboardstock.collector.parser

import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.dashboardstock.collector.api.SignalInput
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * 라씨매매신호 화면 스크래핑 파서
 *
 * 키움증권 앱의 라씨매매신호 화면 구조:
 * - 매수/매도 탭
 * - 시간 그룹 헤더: "22분전", "09:20" 등
 * - 종목 카드: "TIGER 미국달…(456610) 63,565원"
 *
 * AccessibilityNodeInfo 트리에서 텍스트를 추출하여 SignalInput으로 변환
 */
object LassiScreenParser {

    private const val TAG = "LassiScreenParser"

    // 종목 패턴: "종목명(종목코드) 가격원" 또는 "종목명(종목코드)\n가격원"
    private val STOCK_PATTERN = Regex(
        """([가-힣A-Za-z0-9\s&.]+?)\s*\(([0-9A-Za-z]{6})\)\s*([0-9,]+)\s*원"""
    )

    // 시간 그룹 패턴: "09:20", "22분전", "1시간전", "방금전" 등
    private val TIME_GROUP_PATTERN = Regex(
        """(\d{1,2}:\d{2}|\d+분전|\d+시간전|방금전)"""
    )

    // 역산용 패턴
    private val ABSOLUTE_TIME_PATTERN = Regex("""(\d{1,2}):(\d{2})""")
    private val MINUTES_AGO_PATTERN = Regex("""(\d+)분전""")
    private val HOURS_AGO_PATTERN = Regex("""(\d+)시간전""")

    private val SEOUL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    private val SEOUL_OFFSET: ZoneOffset = ZoneOffset.ofHours(9)

    /**
     * timeGroup 문자열을 ISO 8601 타임스탬프로 변환
     * - "09:20" → 당일 09:20:00+09:00 (절대시간 → 정확)
     * - "22분전", "1시간전", "방금전" → null (상대시간 → 부정확하므로 건너뜀)
     *
     * 상대시간 신호는 signal_time = null로 저장되고,
     * 오후 5시 일괄 업데이트에서 절대시간으로 보정됨
     */
    fun resolveSignalTime(timeGroup: String?, now: OffsetDateTime): String? {
        if (timeGroup == null) return null

        val absoluteMatch = ABSOLUTE_TIME_PATTERN.matchEntire(timeGroup)
        if (absoluteMatch != null) {
            val hour = absoluteMatch.groupValues[1].toInt()
            val minute = absoluteMatch.groupValues[2].toInt()
            val resolved = LocalDate.now(SEOUL_ZONE)
                .atTime(LocalTime.of(hour, minute))
                .atOffset(SEOUL_OFFSET)
            return resolved.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
        }

        // 상대시간("방금전", "N분전", "N시간전")은 부정확하므로 null 반환
        // timeGroup 원본은 raw_data에 보존됨
        return null
    }

    /** timeGroup이 상대시간인지 확인 */
    fun isRelativeTime(timeGroup: String?): Boolean {
        if (timeGroup == null) return false
        return MINUTES_AGO_PATTERN.matches(timeGroup)
                || HOURS_AGO_PATTERN.matches(timeGroup)
                || timeGroup == "방금전"
    }

    // 종목코드 6자리 패턴
    private val SYMBOL_PATTERN = Regex("""(\d{6})""")

    // 6자리 코드 (숫자 + WebView 렌더링 오류로 영문 포함 가능)
    private val SYMBOL_ONLY_PATTERN = Regex("""^[0-9A-Za-z]{6}$""")

    // 가격 패턴
    private val PRICE_PATTERN = Regex("""([0-9,]+)\s*원""")

    /**
     * 현재 화면에 보이는 노드에서 종목 정보 추출
     */
    fun parseVisibleNodes(root: AccessibilityNodeInfo, tabName: String): List<SignalInput> {
        val now = OffsetDateTime.now(ZoneId.of("Asia/Seoul"))
        val timestamp = now.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
        val signalType = if (tabName == "매수") "BUY" else "SELL"

        // 전체 텍스트 수집
        val allTexts = mutableListOf<String>()
        collectAllText(root, allTexts)

        val signals = mutableListOf<SignalInput>()
        var currentTimeGroup: String? = null

        // 텍스트 노드들을 순회하며 파싱
        for (text in allTexts) {
            // 시간 그룹 감지
            val timeMatch = TIME_GROUP_PATTERN.find(text)
            if (timeMatch != null && text.length < 15) {
                currentTimeGroup = timeMatch.groupValues[1]
                continue
            }

            // 종목 패턴 매칭 (종목명 + 코드 + 가격이 한 텍스트에)
            val stockMatch = STOCK_PATTERN.find(text)
            if (stockMatch != null) {
                val name = stockMatch.groupValues[1].trim()
                val symbol = stockMatch.groupValues[2]
                val price = stockMatch.groupValues[3].replace(",", "").toIntOrNull()

                signals.add(
                    SignalInput(
                        timestamp = timestamp,
                        symbol = symbol,
                        name = name,
                        signalType = signalType,
                        signalPrice = price,
                        source = "lassi",
                        timeGroup = currentTimeGroup,
                        signalTime = resolveSignalTime(currentTimeGroup, now),
                        isFallback = false
                    )
                )
                continue
            }
        }

        // 패턴 매칭 실패 시 분리된 노드에서 조합 시도
        if (signals.isEmpty()) {
            val combinedSignals = parseFromSeparateNodes(allTexts, signalType, timestamp, currentTimeGroup, now)
            signals.addAll(combinedSignals)
        }

        Log.d(TAG, "$tabName tab parsed: ${signals.size} signals from ${allTexts.size} text nodes")
        return signals
    }

    /**
     * 종목명, 코드, 가격이 별도 노드에 있는 경우 조합
     *
     * 실제 키움앱 UI 구조 (각각 별도 텍스트 노드):
     *   "RISE 2차전지T…"  ← 종목명
     *   "465350"           ← 종목코드 (6자리)
     *   "18,290"           ← 가격
     *   "원"               ← 단위
     */
    private fun parseFromSeparateNodes(
        texts: List<String>,
        signalType: String,
        timestamp: String,
        defaultTimeGroup: String?,
        now: OffsetDateTime
    ): List<SignalInput> {
        val signals = mutableListOf<SignalInput>()
        var currentTimeGroup = defaultTimeGroup
        var i = 0

        while (i < texts.size) {
            val text = texts[i]

            // 시간 그룹 업데이트
            if (TIME_GROUP_PATTERN.matches(text)) {
                currentTimeGroup = text
                i++
                continue
            }

            // "N종목" 스킵
            if (text.endsWith("종목")) {
                i++
                continue
            }

            // 6자리 숫자만으로 이루어진 텍스트 = 종목코드
            if (SYMBOL_ONLY_PATTERN.matches(text)) {
                val symbol = text
                // 이전 텍스트가 종목명
                val name = if (i > 0) texts[i - 1].trim() else ""

                // 다음 텍스트에서 가격 추출
                var price: Int? = null
                if (i + 1 < texts.size) {
                    val priceText = texts[i + 1].replace(",", "")
                    price = priceText.toIntOrNull()
                    if (price != null) i++ // 가격 노드 소비
                }
                // "원" 스킵
                if (i + 1 < texts.size && texts[i + 1] == "원") i++

                if (name.isNotEmpty() && !name.matches(Regex("\\d+")) && name != "원" && name != "매수" && name != "매도") {
                    signals.add(
                        SignalInput(
                            timestamp = timestamp,
                            symbol = symbol,
                            name = name,
                            signalType = signalType,
                            signalPrice = price,
                            source = "lassi",
                            timeGroup = currentTimeGroup,
                            signalTime = resolveSignalTime(currentTimeGroup, now),
                            isFallback = false
                        )
                    )
                }
            }
            i++
        }

        return signals
    }

    /**
     * AccessibilityNodeInfo 트리에서 모든 텍스트 수집 (DFS)
     */
    private fun collectAllText(node: AccessibilityNodeInfo, result: MutableList<String>) {
        val text = node.text?.toString()?.trim()
        if (!text.isNullOrEmpty()) {
            result.add(text)
        }

        // content-description도 수집
        val desc = node.contentDescription?.toString()?.trim()
        if (!desc.isNullOrEmpty() && desc != text) {
            result.add(desc)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectAllText(child, result)
            child.recycle()
        }
    }
}
