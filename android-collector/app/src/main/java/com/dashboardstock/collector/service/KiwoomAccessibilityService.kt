package com.dashboardstock.collector.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.dashboardstock.collector.api.SignalApiClient
import com.dashboardstock.collector.api.SignalInput
import com.dashboardstock.collector.db.SentSignalCache
import com.dashboardstock.collector.db.SignalQueueManager
import com.dashboardstock.collector.parser.LassiScreenParser
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * 키움증권 라씨매매신호 스크래핑 AccessibilityService
 *
 * 흐름: IDLE → LAUNCHING_APP → CLICKING_BUY → SCRAPING_BUY → CLICKING_SELL → SCRAPING_SELL → COMPLETED
 *
 * 핵심: WebView 내부 요소 클릭 시 다중 전략 사용
 *   1) 노드 자체 ACTION_CLICK
 *   2) 클릭 가능한 부모 노드 ACTION_CLICK
 *   3) 좌표 기반 제스처 탭 (150ms 롱탭)
 */
class KiwoomAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "KiwoomA11y"
        const val ACTION_START_SCRAPING = "com.dashboardstock.collector.START_SCRAPING"
        private const val KIWOOM_PACKAGE = "com.kiwoom.heromts"
        private const val STEP_TIMEOUT_MS = 15000L
        private const val OVERALL_TIMEOUT_MS = 600000L  // 10분
        private const val SCRAPING_WATCHDOG_MS = 60000L // 60초 워치독

        @Volatile
        var instance: KiwoomAccessibilityService? = null
            private set

        /** 외부에서 스크래핑 진행 여부 확인용 */
        @Volatile
        var isScrapingActive: Boolean = false
            private set

        var onScrapingResult: ((buyCount: Int, sellCount: Int, success: Boolean, error: String?) -> Unit)? = null
    }

    enum class State {
        IDLE,
        LAUNCHING_APP,      // 키움앱 실행 대기
        CLICKING_AI_SIGNAL, // "AI매매신호" 메뉴 클릭
        WAITING_SIGNAL,     // 매수/매도 화면 대기
        CLICKING_BUY,       // 매수 숫자 클릭 시도 중
        SCRAPING_BUY,       // 매수 종목 파싱
        CLICKING_SELL_TAB,  // 매도 탭 클릭 + 전환 검증 중
        SCRAPING_SELL,      // 매도 종목 파싱
        COMPLETED,
        FAILED
    }

    private var state = State.IDLE
    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val buySignals = mutableListOf<SignalInput>()
    private val sellSignals = mutableListOf<SignalInput>()
    private val seenSymbols = mutableSetOf<String>()
    private var noNewCount = 0
    private var clickAttempt = 0
    private var debouncing = false // 이벤트 디바운싱용
    private var waiting = false   // 스크롤/전환 대기용 (더 긴 차단)

    /** true이면 INSERT 대신 signal_time PATCH만 수행 (오후 5시 보정용) */
    private var updateMode = false

    private val stepTimeoutRunnable = Runnable { onStepTimeout() }
    private val overallTimeoutRunnable = Runnable { onOverallTimeout() }
    private val scrapingWatchdogRunnable = Runnable { onScrapingWatchdog() }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Service connected")
    }

    override fun onDestroy() {
        instance = null
        isScrapingActive = false
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || state == State.IDLE || state == State.COMPLETED || state == State.FAILED) return
        if (event.packageName?.toString() != KIWOOM_PACKAGE) return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                scheduleProcess()
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Service interrupted")
        resetState()
    }

    fun startScraping(isUpdate: Boolean = false) {
        if (state != State.IDLE) {
            Log.w(TAG, "Already scraping: $state")
            return
        }

        updateMode = isUpdate
        Log.i(TAG, "=== Starting scraping (updateMode=$updateMode) ===")
        isScrapingActive = true
        buySignals.clear()
        sellSignals.clear()
        seenSymbols.clear()
        noNewCount = 0
        clickAttempt = 0
        waiting = false

        handler.postDelayed(overallTimeoutRunnable, OVERALL_TIMEOUT_MS)
        handler.postDelayed(scrapingWatchdogRunnable, SCRAPING_WATCHDOG_MS)
        transitionTo(State.LAUNCHING_APP)
        launchKiwoomApp()
    }

    private fun transitionTo(newState: State) {
        Log.i(TAG, "State: $state → $newState")
        state = newState
        handler.removeCallbacks(stepTimeoutRunnable)
        if (newState != State.COMPLETED && newState != State.FAILED && newState != State.IDLE) {
            handler.postDelayed(stepTimeoutRunnable, STEP_TIMEOUT_MS)
        }
    }

    /** 이벤트 디바운싱: waiting 중이면 완전 무시, 아니면 500ms 디바운싱 */
    private fun scheduleProcess() {
        if (waiting || debouncing) return
        debouncing = true
        handler.postDelayed({
            debouncing = false
            if (!waiting) processState()
        }, 500)
    }

    private fun processState() {
        val root = rootInActiveWindow ?: return
        try {
            when (state) {
                State.LAUNCHING_APP -> onLaunchingApp(root)
                State.CLICKING_AI_SIGNAL -> onClickingAiSignal(root)
                State.WAITING_SIGNAL -> onWaitingSignal(root)
                State.CLICKING_BUY -> onClickingTab(root, "매수")
                State.SCRAPING_BUY -> onScrapingTab(root, "매수", buySignals)
                State.CLICKING_SELL_TAB -> {} // 자체 타이머로 처리
                State.SCRAPING_SELL -> onScrapingTab(root, "매도", sellSignals)
                else -> {}
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in $state", e)
        } finally {
            root.recycle()
        }
    }

    // ===== 단계별 핸들러 =====

    /**
     * LAUNCHING_APP: 키움앱이 로드되면 → "AI매매신호" 메뉴 클릭 단계로
     */
    private fun onLaunchingApp(root: AccessibilityNodeInfo) {
        dumpNodeTree(root, 0, 3)

        // 앱이 로드됐는지 확인 (content-desc에 "AI매매신호"가 있으면 앱 로드 완료)
        val descs = collectContentDescs(root)
        val texts = collectTexts(root)
        Log.d(TAG, "LAUNCHING: descs=${descs.take(10)}, texts(${texts.size}): ${texts.take(10)}")

        if (descs.any { it.contains("AI매매신호") } || texts.any { it.contains("AI매매신호") }) {
            Log.i(TAG, "App loaded, moving to click AI매매신호")
            clickAttempt = 0
            transitionTo(State.CLICKING_AI_SIGNAL)
            handler.postDelayed({ processState() }, 500)
        } else if (texts.any { it == "매수" } && texts.any { it == "매도" }) {
            // 이미 신호 화면에 있는 경우
            Log.i(TAG, "Already on signal screen, go to CLICKING_BUY")
            clickAttempt = 0
            transitionTo(State.CLICKING_BUY)
            handler.postDelayed({ processState() }, 500)
        }
    }

    /**
     * CLICKING_AI_SIGNAL: "AI매매신호" content-desc 노드를 찾아 클릭
     */
    private fun onClickingAiSignal(root: AccessibilityNodeInfo) {
        clickAttempt++
        Log.i(TAG, "Clicking 'AI매매신호' attempt #$clickAttempt")

        // content-desc로 노드 찾기
        val aiNode = findNodeByContentDesc(root, "AI매매신호")
        if (aiNode != null) {
            val rect = Rect()
            aiNode.getBoundsInScreen(rect)
            Log.d(TAG, "'AI매매신호' found: rect=$rect clickable=${aiNode.isClickable} class=${aiNode.className}")

            // 클릭 시도
            clickWithMultiStrategy(aiNode, rect)
            aiNode.recycle()

            // 화면 전환 대기 → WAITING_SIGNAL
            waiting = true
            handler.postDelayed({
                waiting = false
                clickAttempt = 0
                transitionTo(State.WAITING_SIGNAL)
                processState()
            }, 2500)
        } else if (clickAttempt < 3) {
            Log.w(TAG, "'AI매매신호' not found, retry in 2s")
            handler.postDelayed({ processState() }, 2000)
        } else {
            Log.e(TAG, "'AI매매신호' not found after $clickAttempt attempts, trying direct")
            // 못찾으면 바로 매수/매도 화면 대기
            clickAttempt = 0
            transitionTo(State.WAITING_SIGNAL)
        }
    }

    /**
     * WAITING_SIGNAL: "매수"/"매도" 텍스트가 보이면 → CLICKING_BUY
     */
    private var lassiClickAttempt = 0

    private fun onWaitingSignal(root: AccessibilityNodeInfo) {
        val texts = collectTexts(root)
        val descs = collectContentDescs(root)
        val hasBuy = texts.any { it == "매수" } || descs.any { it.contains("매수") }
        val hasSell = texts.any { it == "매도" } || descs.any { it.contains("매도") }

        if (hasBuy && hasSell) {
            Log.i(TAG, "Signal screen ready → CLICKING_BUY")
            clickAttempt = 0
            lassiClickAttempt = 0
            transitionTo(State.CLICKING_BUY)
            handler.postDelayed({ processState() }, 500)
        } else {
            Log.d(TAG, "Waiting for 매수/매도... texts(${texts.size}): ${texts.take(15)}")
            Log.d(TAG, "  descs(${descs.size}): $descs")

            // "라씨매매신호" 서브메뉴 클릭 필요할 수 있음
            if (lassiClickAttempt < 3) {
                // content-desc에서 "라씨매매신호" 찾기
                val lassiNode = findNodeByContentDesc(root, "라씨매매신호")
                if (lassiNode != null) {
                    lassiClickAttempt++
                    val rect = Rect()
                    lassiNode.getBoundsInScreen(rect)
                    Log.i(TAG, "Found '라씨매매신호' desc node at $rect, clicking (attempt $lassiClickAttempt)")
                    clickWithMultiStrategy(lassiNode, rect)
                    lassiNode.recycle()
                    waiting = true
                    handler.postDelayed({ waiting = false; processState() }, 2500)
                    return
                }
                // text에서 "라씨매매신호" 포함 노드 찾기
                val lassiTextNode = findTextNodeContaining(root, "라씨매매신호")
                if (lassiTextNode != null) {
                    lassiClickAttempt++
                    val rect = Rect()
                    lassiTextNode.getBoundsInScreen(rect)
                    Log.i(TAG, "Found '라씨매매신호' text node at $rect, clicking (attempt $lassiClickAttempt)")
                    clickWithMultiStrategy(lassiTextNode, rect)
                    lassiTextNode.recycle()
                    waiting = true
                    handler.postDelayed({ waiting = false; processState() }, 2500)
                    return
                }
                Log.d(TAG, "'라씨매매신호' node not found")
            }
        }
    }

    /** text에 특정 문자열이 포함된 노드 찾기 (DFS) */
    private fun findTextNodeContaining(node: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        val nodeText = node.text?.toString()?.trim() ?: ""
        if (nodeText.contains(text)) {
            return AccessibilityNodeInfo.obtain(node)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findTextNodeContaining(child, text)
            if (found != null) {
                child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }

    /**
     * CLICKING_BUY / CLICKING_SELL: 숫자 노드를 찾아서 다중 전략으로 클릭
     */
    private fun onClickingTab(root: AccessibilityNodeInfo, tabName: String) {
        clickAttempt++
        Log.i(TAG, "Clicking '$tabName' attempt #$clickAttempt")

        // 먼저 현재 활성 탭 확인
        val activeTab = getActiveTab(root)
        Log.d(TAG, "Current active tab: '$activeTab', want: '$tabName'")

        // 이미 매수 탭이면 바로 스크래핑 시작
        if (activeTab == tabName) {
            Log.i(TAG, "'$tabName' tab already active, start scraping")
            clickAttempt = 0
            transitionTo(State.SCRAPING_BUY)
            noNewCount = 0
            processState()
            return
        }

        // 디버그: 매수/매도 주변 노드 상세 덤프
        dumpBuySellArea(root)

        val clicked = tryClickNumber(root, tabName)
        // 500ms 후 한번 더 클릭 (WebView 첫 클릭 무시 문제 대응)
        if (clicked) {
            handler.postDelayed({
                val r = rootInActiveWindow
                if (r != null) {
                    tryClickNumber(r, tabName)
                    r.recycle()
                }
            }, 500)
        }

        if (clicked) {
            Log.i(TAG, "'$tabName' click dispatched x2, verifying tab switch...")
            waiting = true
            handler.postDelayed({
                waiting = false
                // 탭 전환 검증
                val freshRoot = rootInActiveWindow
                if (freshRoot != null) {
                    val nowActive = getActiveTab(freshRoot)
                    Log.d(TAG, "After click: active tab='$nowActive', want='$tabName'")
                    if (nowActive == tabName) {
                        Log.i(TAG, "'$tabName' tab switch confirmed!")
                        clickAttempt = 0
                        transitionTo(State.SCRAPING_BUY)
                        noNewCount = 0
                        processState()
                    } else if (clickAttempt < 5) {
                        Log.w(TAG, "'$tabName' tab switch failed, retrying...")
                        processState()  // CLICKING_BUY 상태 유지, 재시도
                    } else {
                        Log.e(TAG, "'$tabName' tab switch failed after $clickAttempt attempts, proceeding anyway")
                        transitionTo(State.SCRAPING_BUY)
                        processState()
                    }
                    freshRoot.recycle()
                } else {
                    transitionTo(State.SCRAPING_BUY)
                    processState()
                }
            }, 3000)
        } else if (clickAttempt < 5) {
            Log.w(TAG, "Click attempt $clickAttempt failed, retrying in 2s...")
            handler.postDelayed({ processState() }, 2000)
        } else {
            Log.e(TAG, "Failed to click '$tabName' after $clickAttempt attempts")
            transitionTo(State.SCRAPING_BUY)
            processState()
        }
    }

    /** 현재 활성 탭 감지: 트리에서 "매수 매도 X" 패턴의 X를 반환 */
    private fun getActiveTab(root: AccessibilityNodeInfo): String {
        val texts = collectTexts(root)
        for (i in texts.indices) {
            val t = texts[i].trim()
            if ((t == "매수 매도 매수") || (t == "매수 매도 매도")) {
                return if (t.endsWith("매수")) "매수" else "매도"
            }
        }
        // 패턴 못 찾으면 개별 텍스트로 시도: "매수", "매도" 다음에 나오는 "매수"/"매도"
        for (i in 0 until texts.size - 2) {
            if (texts[i] == "매수" && texts[i + 1] == "매도") {
                val active = texts[i + 2]
                if (active == "매수" || active == "매도") return active
            }
        }
        return "unknown"
    }

    /**
     * 다중 전략으로 매수/매도 숫자 노드 클릭
     * 반환: 클릭 시도 여부
     */
    private fun tryClickNumber(root: AccessibilityNodeInfo, tabName: String): Boolean {
        // 1) 먼저 "매수"/"매도" 레이블 노드 찾기
        val labelNode = findTextNode(root, tabName)
        if (labelNode == null) {
            Log.w(TAG, "Label '$tabName' not found")
            return false
        }

        val labelRect = Rect()
        labelNode.getBoundsInScreen(labelRect)
        Log.d(TAG, "'$tabName' label at $labelRect")

        // 2) 같은 Y 영역의 숫자 노드 찾기
        val numberNodes = findNumberNodesNearY(root, labelRect.centerY(), 80)
        Log.d(TAG, "Found ${numberNodes.size} number nodes near Y=${labelRect.centerY()}")
        for ((node, rect, text) in numberNodes) {
            Log.d(TAG, "  num='$text' rect=$rect clickable=${node.isClickable} " +
                    "focusable=${node.isFocusable} class=${node.className}")
        }

        // 3) 타겟 숫자 선택
        val target = if (tabName == "매수") {
            numberNodes.filter { it.second.left > labelRect.right }.minByOrNull { it.second.left }
        } else {
            numberNodes.filter { it.second.right < labelRect.left }.maxByOrNull { it.second.right }
        }

        if (target == null) {
            Log.w(TAG, "No target number found for '$tabName'")
            // 폴백: 레이블 자체 클릭 시도
            clickWithMultiStrategy(labelNode, labelRect)
            labelNode.recycle()
            return true
        }

        val (targetNode, targetRect, targetText) = target
        Log.i(TAG, "Target: '$targetText' at $targetRect")

        // 4) 다중 전략 클릭
        clickWithMultiStrategy(targetNode, targetRect)

        // 정리
        labelNode.recycle()
        for ((n, _, _) in numberNodes) n.recycle()

        return true
    }

    /**
     * 다중 전략으로 노드 클릭 시도
     * 전략 1: 노드 자체 ACTION_CLICK
     * 전략 2: 좌표 기반 제스처 탭 (200ms) — WebView 내부 요소에 가장 확실
     * 전략 3: 클릭 가능한 부모 노드 ACTION_CLICK (보조)
     *
     * WebView 내부 요소는 ACTION_CLICK이 작동하지 않는 경우가 많으므로
     * 제스처 탭을 우선 사용
     */
    private fun clickWithMultiStrategy(node: AccessibilityNodeInfo, rect: Rect) {
        val cx = rect.centerX().toFloat()
        val cy = rect.centerY().toFloat()

        try {
            // 전략 1: 직접 ACTION_CLICK (노드 자체가 clickable인 경우)
            if (node.isClickable) {
                Log.d(TAG, "Strategy 1: Direct ACTION_CLICK (node is clickable)")
                try {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                } catch (e: Exception) {
                    Log.w(TAG, "Strategy 1 ACTION_CLICK failed", e)
                }
                return
            }

            // 전략 2: 제스처 탭 (WebView 요소에 가장 확실)
            Log.d(TAG, "Strategy 2: Gesture tap at ($cx, $cy) duration=200ms")
            performTap(cx, cy, 200)

            // 전략 3: 클릭 가능한 부모도 시도 (보조)
            var parent = node.parent
            var depth = 0
            while (parent != null && depth < 5) {
                if (parent.isClickable) {
                    val parentRect = Rect()
                    parent.getBoundsInScreen(parentRect)
                    // 부모가 전체 WebView 컨테이너가 아닌 경우에만 클릭
                    if (parentRect.width() < rect.width() * 5) {
                        Log.d(TAG, "Strategy 3: Parent ACTION_CLICK (depth=$depth, rect=$parentRect)")
                        try {
                            parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        } catch (e: Exception) {
                            Log.w(TAG, "Strategy 3 parent ACTION_CLICK failed", e)
                        }
                    }
                    parent.recycle()
                    return
                }
                val grandparent = parent.parent
                parent.recycle()
                parent = grandparent
                depth++
            }
            parent?.recycle()
        } catch (e: Exception) {
            Log.e(TAG, "clickWithMultiStrategy failed for rect=$rect", e)
        }
    }

    private var scrollCount = 0
    private val MAX_SCROLL = 100
    private var targetCount = 0  // 트리에서 읽은 목표 개수

    /**
     * SCRAPING: 파싱 + 스크롤하여 목표 개수까지 수집
     *
     * 화면 상단에 매수/매도 숫자가 있음 (예: "11", "31")
     * 이 숫자를 목표로 삼아 그 수에 도달할 때까지 스크롤 반복
     */
    private fun onScrapingTab(root: AccessibilityNodeInfo, tabName: String, resultList: MutableList<SignalInput>) {
        val allTexts = collectTexts(root)

        // 첫 파싱 시 목표 개수 읽기
        if (scrollCount == 0 && targetCount == 0) {
            targetCount = readTargetCount(allTexts, tabName)
            Log.i(TAG, "$tabName target count: $targetCount")
        }

        Log.d(TAG, "$tabName tree (${allTexts.size} nodes): ${allTexts.take(30)}")

        val signals = LassiScreenParser.parseVisibleNodes(root, tabName)
        var newCount = 0

        for (signal in signals) {
            val key = "${signal.symbol}_${signal.signalType}"
            if (seenSymbols.add(key)) {
                resultList.add(signal)
                newCount++
            }
        }

        Log.d(TAG, "$tabName: parsed=${signals.size}, new=$newCount, total=${resultList.size}/" +
                "$targetCount, noNew=$noNewCount, scroll=$scrollCount")

        // 목표 도달 체크
        if (targetCount > 0 && resultList.size >= targetCount) {
            Log.i(TAG, "$tabName: target reached! ${resultList.size}/$targetCount")
            finishTab(root, tabName, resultList)
            return
        }

        if (newCount > 0) {
            noNewCount = 0
        } else {
            noNewCount++
        }

        // 95% 이상 + 새 항목 없으면 완료 (파서 누락 감안)
        if (targetCount > 0 && resultList.size >= (targetCount * 0.95).toInt() && noNewCount >= 3) {
            Log.i(TAG, "$tabName: close enough ${resultList.size}/$targetCount (${noNewCount} noNew), finishing")
            finishTab(root, tabName, resultList)
            return
        }

        // 스크롤 계속 여부 결정
        val needMore = targetCount > 0 && resultList.size < targetCount
        if (needMore && scrollCount < MAX_SCROLL && noNewCount < 10) {
            // 목표 미달 → 스크롤 계속
            scrollCount++
            // step timer 리셋 (스크래핑 진행 중이므로 timeout 방지)
            handler.removeCallbacks(stepTimeoutRunnable)
            handler.postDelayed(stepTimeoutRunnable, STEP_TIMEOUT_MS)
            Log.d(TAG, "$tabName: scrolling ($scrollCount/$MAX_SCROLL), need ${targetCount - resultList.size} more")
            scrollDown(root)
            // 스크롤 완료 후 능동적으로 파싱 재실행 (이벤트 대기 안함)
            waiting = true
            handler.postDelayed({
                waiting = false
                processState()
            }, 200)
        } else if (!needMore && noNewCount < 2 && scrollCount < MAX_SCROLL) {
            // 목표 모름 → 기존 로직 (새 항목 없으면 1번 더 시도)
            scrollCount++
            handler.removeCallbacks(stepTimeoutRunnable)
            handler.postDelayed(stepTimeoutRunnable, STEP_TIMEOUT_MS)
            scrollDown(root)
            waiting = true
            handler.postDelayed({
                waiting = false
                processState()
            }, 200)
        } else {
            finishTab(root, tabName, resultList)
        }
    }

    /**
     * 트리에서 매수/매도 목표 개수 읽기
     *
     * 트리 구조: [..., "매수", "11", "31", "매도", ...]
     * 매수 탭이면 매수 바로 뒤 숫자, 매도 탭이면 매도 바로 앞 숫자
     */
    private fun readTargetCount(texts: List<String>, tabName: String): Int {
        for (i in texts.indices) {
            if (texts[i] == "매수" && i + 1 < texts.size) {
                val buyCount = texts[i + 1].toIntOrNull()
                if (buyCount != null && i + 2 < texts.size) {
                    val sellCount = texts[i + 2].toIntOrNull()
                    if (sellCount != null) {
                        Log.d(TAG, "Found counts: buy=$buyCount, sell=$sellCount")
                        return if (tabName == "매수") buyCount else sellCount
                    }
                }
            }
        }
        return 0
    }

    private fun finishTab(root: AccessibilityNodeInfo, tabName: String, resultList: MutableList<SignalInput>) {
        Log.i(TAG, "$tabName done: ${resultList.size} signals after $scrollCount scrolls (target=$targetCount)")
        noNewCount = 0
        scrollCount = 0
        targetCount = 0
        if (state == State.SCRAPING_BUY) {
            Log.i(TAG, "Buy done: ${buySignals.size} → switching to 매도 tab")
            switchToSellTab(root)
        } else {
            Log.i(TAG, "Sell done: ${sellSignals.size}")
            onComplete()
        }
    }

    /**
     * 매수 → 매도 탭 전환
     * 한번만 실행되도록 state를 먼저 전환
     * 탭 전환 실패 시 재시도 (최대 3회)
     */
    private var sellTabClickCount = 0

    private fun switchToSellTab(root: AccessibilityNodeInfo) {
        // 즉시 상태 전환 (중복 호출 방지)
        clickAttempt = 0
        sellTabClickCount = 0
        transitionTo(State.CLICKING_SELL_TAB)
        waiting = true

        // 매수 종목 심볼 기록 (매도 전환 검증용)
        buySymbolsForVerify.clear()
        buySymbolsForVerify.addAll(buySignals.mapNotNull { it.symbol })
        Log.d(TAG, "Buy symbols for verify: $buySymbolsForVerify")

        // "매도" 탭 클릭
        clickSellTab(root)

        // 3초 대기 후 전환 검증
        handler.postDelayed({
            waiting = false
            sellTabClickCount++
            verifySellTabSwitch()
        }, 3000)
    }

    private val buySymbolsForVerify = mutableSetOf<String>()

    /**
     * 매도 탭으로 실제 전환됐는지 검증
     * 접근성 트리의 종목이 매수 목록과 다르면 성공
     */
    private fun verifySellTabSwitch() {
        val root = rootInActiveWindow ?: return
        try {
            val signals = LassiScreenParser.parseVisibleNodes(root, "매도")
            val sellSymbols = signals.map { it.symbol }.toSet()
            val overlap = sellSymbols.intersect(buySymbolsForVerify)
            val overlapRatio = if (sellSymbols.isNotEmpty()) overlap.size.toFloat() / sellSymbols.size else 1f

            Log.d(TAG, "Sell tab verify: parsed=${signals.size}, overlap=${overlap.size}/${sellSymbols.size} (${(overlapRatio*100).toInt()}%)")

            if (signals.isEmpty() || (overlapRatio > 0.7f && sellTabClickCount < 3)) {
                // 매수 데이터와 70% 이상 겹침 → 탭 전환 실패, 재시도
                Log.w(TAG, "Sell tab switch failed (attempt $sellTabClickCount), retrying...")
                waiting = true
                clickSellTab(root)
                handler.postDelayed({
                    waiting = false
                    sellTabClickCount++
                    verifySellTabSwitch()
                }, 3000)
            } else {
                // 전환 성공 → 파싱 시작
                Log.i(TAG, "Sell tab switch verified! Starting sell scraping")
                seenSymbols.clear()
                noNewCount = 0
                transitionTo(State.SCRAPING_SELL)
                processState()
            }
        } finally {
            root.recycle()
        }
    }

    /**
     * 매수 목록 화면 내에서 "매도" 탭 전환
     *
     * 매수 진입 시 숫자 "11"을 클릭해서 성공 → 매도도 숫자 "30"을 클릭해야 함
     * tryClickNumber(root, "매도")와 동일한 로직 사용
     */
    private fun clickSellTab(root: AccessibilityNodeInfo) {
        val clicked = tryClickNumber(root, "매도")
        if (!clicked) {
            // 숫자 클릭 실패 시 "매도" 텍스트 직접 제스처 탭 (폴백)
            val allSellNodes = findAllTextNodes(root, "매도")
            val target = allSellNodes.maxByOrNull { it.second.centerY() }
            if (target != null) {
                val (_, rect) = target
                val cx = rect.centerX().toFloat()
                val cy = rect.centerY().toFloat()
                Log.i(TAG, "Fallback: Clicking '매도' text at ($cx, $cy)")
                performTap(cx, cy, 200)
            }
            for ((node, _) in allSellNodes) node.recycle()
        }
    }

    /** 특정 텍스트와 일치하는 모든 노드 찾기 (DFS) */
    private fun findAllTextNodes(root: AccessibilityNodeInfo, text: String): List<Pair<AccessibilityNodeInfo, Rect>> {
        val result = mutableListOf<Pair<AccessibilityNodeInfo, Rect>>()
        findAllTextNodesRecursive(root, text, result)
        return result
    }

    private fun findAllTextNodesRecursive(
        node: AccessibilityNodeInfo,
        text: String,
        result: MutableList<Pair<AccessibilityNodeInfo, Rect>>
    ) {
        if (node.text?.toString()?.trim() == text) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            result.add(Pair(AccessibilityNodeInfo.obtain(node), rect))
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findAllTextNodesRecursive(child, text, result)
            child.recycle()
        }
    }

    // ===== 유틸리티 =====

    private fun launchKiwoomApp() {
        val intent = packageManager.getLaunchIntentForPackage(KIWOOM_PACKAGE)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(intent)
            Log.d(TAG, "Launched Kiwoom app")
        } else {
            Log.e(TAG, "Kiwoom app not found")
            fail("Kiwoom app not installed")
        }
    }

    /** content-description 수집 */
    private fun collectContentDescs(node: AccessibilityNodeInfo): List<String> {
        val result = mutableListOf<String>()
        collectContentDescsRecursive(node, result)
        return result
    }

    private fun collectContentDescsRecursive(node: AccessibilityNodeInfo, result: MutableList<String>) {
        node.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { result.add(it) }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectContentDescsRecursive(child, result)
            child.recycle()
        }
    }

    /** content-desc로 노드 찾기 (DFS) */
    private fun findNodeByContentDesc(node: AccessibilityNodeInfo, desc: String): AccessibilityNodeInfo? {
        if (node.contentDescription?.toString()?.trim() == desc) {
            return AccessibilityNodeInfo.obtain(node)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNodeByContentDesc(child, desc)
            if (found != null) {
                child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }

    /** DFS로 모든 text 노드 수집 */
    private fun collectTexts(node: AccessibilityNodeInfo): List<String> {
        val result = mutableListOf<String>()
        collectTextsRecursive(node, result)
        return result
    }

    private fun collectTextsRecursive(node: AccessibilityNodeInfo, result: MutableList<String>) {
        node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { result.add(it) }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectTextsRecursive(child, result)
            child.recycle()
        }
    }

    /** text가 정확히 일치하는 노드 찾기 (DFS) */
    private fun findTextNode(node: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        if (node.text?.toString()?.trim() == text) {
            return AccessibilityNodeInfo.obtain(node)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findTextNode(child, text)
            if (found != null) {
                child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }

    /** 특정 Y 좌표 근처의 1~3자리 숫자 노드 찾기 */
    private fun findNumberNodesNearY(
        root: AccessibilityNodeInfo,
        targetY: Int,
        tolerance: Int
    ): List<Triple<AccessibilityNodeInfo, Rect, String>> {
        val result = mutableListOf<Triple<AccessibilityNodeInfo, Rect, String>>()
        findNumberNodesRecursive(root, targetY, tolerance, result)
        return result
    }

    private fun findNumberNodesRecursive(
        node: AccessibilityNodeInfo,
        targetY: Int,
        tolerance: Int,
        result: MutableList<Triple<AccessibilityNodeInfo, Rect, String>>
    ) {
        val text = node.text?.toString()?.trim() ?: ""
        if (text.matches(Regex("\\d{1,3}"))) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            if (Math.abs(rect.centerY() - targetY) <= tolerance) {
                result.add(Triple(AccessibilityNodeInfo.obtain(node), rect, text))
            }
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findNumberNodesRecursive(child, targetY, tolerance, result)
            child.recycle()
        }
    }

    /**
     * 리스트 스크롤 - 제스처 스와이프만 사용
     *
     * ACTION_SCROLL_DOWN/FORWARD 모두 실패 확인됨 (WebView scrollable=false)
     * dispatchGesture 멀티파트가 유일하게 동작.
     *
     * 핵심: 스와이프 좌표가 탭 버튼(y≈1338) 영역에 절대 닿지 않도록
     * y=2250 → y=1650 범위에서만 동작. 1회에 3번 연속 스와이프.
     */
    private fun scrollDown(root: AccessibilityNodeInfo) {
        Log.d(TAG, "Scroll: attempt #$scrollCount, dispatching 3 consecutive swipes")
        doConsecutiveSwipes(3, 0)
    }

    /** N회 연속 스와이프: 1회 완료 후 다음 실행 */
    private fun doConsecutiveSwipes(remaining: Int, count: Int) {
        if (remaining <= 0) return
        val cx = resources.displayMetrics.widthPixels / 2f  // 540
        // 안전 영역: 탭 버튼(y≈1338)보다 충분히 아래인 y=1650에서 종료
        val startY = 2250f
        val endY = 1650f

        val path = Path().apply {
            moveTo(cx, startY)
            lineTo(cx, endY)
        }
        // 50ms = 초고속 fling 스와이프
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                if (remaining > 1) {
                    handler.postDelayed({
                        doConsecutiveSwipes(remaining - 1, count + 1)
                    }, 100)
                }
            }
            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "Scroll: swipe ${count+1} cancelled")
            }
        }, null)
    }

    private fun performTap(x: Float, y: Float, durationMs: Long) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "Tap completed at ($x, $y)")
            }
            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "Tap cancelled at ($x, $y)")
            }
        }, null)
    }

    // ===== 디버그 =====

    /** 노드 트리 덤프 (디버깅용) */
    private fun dumpNodeTree(node: AccessibilityNodeInfo, depth: Int, maxDepth: Int) {
        if (depth > maxDepth) return
        val indent = "  ".repeat(depth)
        val rect = Rect()
        node.getBoundsInScreen(rect)
        val text = node.text?.toString()?.take(30) ?: ""
        val desc = node.contentDescription?.toString()?.take(30) ?: ""
        val cls = node.className?.toString()?.substringAfterLast('.') ?: ""
        val flags = buildString {
            if (node.isClickable) append("C")
            if (node.isFocusable) append("F")
            if (node.isScrollable) append("S")
            if (node.isCheckable) append("K")
        }

        if (text.isNotEmpty() || desc.isNotEmpty() || flags.isNotEmpty()) {
            Log.d(TAG, "${indent}[$cls] text='$text' desc='$desc' flags=$flags rect=$rect")
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            dumpNodeTree(child, depth + 1, maxDepth)
            child.recycle()
        }
    }

    /** 매수/매도 영역 주변 노드 상세 덤프 */
    private fun dumpBuySellArea(root: AccessibilityNodeInfo) {
        Log.d(TAG, "=== Buy/Sell area dump ===")
        val buyNode = findTextNode(root, "매수")
        val sellNode = findTextNode(root, "매도")

        if (buyNode != null) {
            val r = Rect()
            buyNode.getBoundsInScreen(r)
            Log.d(TAG, "'매수' rect=$r clickable=${buyNode.isClickable} class=${buyNode.className}")

            // 부모 체인 덤프
            var parent = buyNode.parent
            var d = 1
            while (parent != null && d <= 5) {
                val pr = Rect()
                parent.getBoundsInScreen(pr)
                Log.d(TAG, "  parent[$d] class=${parent.className} clickable=${parent.isClickable} " +
                        "focusable=${parent.isFocusable} rect=$pr children=${parent.childCount}")
                val gp = parent.parent
                parent.recycle()
                parent = gp
                d++
            }
            parent?.recycle()
            buyNode.recycle()
        }

        if (sellNode != null) {
            val r = Rect()
            sellNode.getBoundsInScreen(r)
            Log.d(TAG, "'매도' rect=$r clickable=${sellNode.isClickable} class=${sellNode.className}")
            sellNode.recycle()
        }
        Log.d(TAG, "=== End dump ===")
    }

    // ===== 완료/실패 =====

    private fun onComplete() {
        handler.removeCallbacksAndMessages(null)
        handler.removeCallbacks(scrapingWatchdogRunnable)
        transitionTo(State.COMPLETED)

        // 키움앱: back 버튼으로 나간 후 홈으로
        performGlobalAction(GLOBAL_ACTION_BACK)
        handler.postDelayed({
            performGlobalAction(GLOBAL_ACTION_BACK)
            handler.postDelayed({
                performGlobalAction(GLOBAL_ACTION_HOME)
            }, 500)
        }, 500)

        val all = buySignals + sellSignals
        Log.i(TAG, "Complete: ${buySignals.size} buys + ${sellSignals.size} sells = ${all.size}")

        if (all.isEmpty()) {
            Log.w(TAG, "No signals scraped")
            onScrapingResult?.invoke(0, 0, false, "No signals found")
            resetState()
            return
        }

        val bc = buySignals.size
        val sc = sellSignals.size

        if (updateMode) {
            // 오후 5시 보정 모드: signal_time이 있는 신호만 PATCH
            val withTime = all.filter { it.signalTime != null }
            Log.i(TAG, "Update mode: ${withTime.size}/${all.size} signals have absolute time")

            if (withTime.isEmpty()) {
                onScrapingResult?.invoke(bc, sc, true, "No signals with absolute time to update")
                resetState()
                return
            }

            scope.launch {
                try {
                    SignalApiClient.updateSignalTimes(withTime)
                    Log.i(TAG, "Signal times updated: ${withTime.size}")
                    withContext(Dispatchers.Main) {
                        onScrapingResult?.invoke(bc, sc, true, "Updated ${withTime.size} signal times")
                        resetState()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Update signal times failed", e)
                    withContext(Dispatchers.Main) {
                        onScrapingResult?.invoke(bc, sc, false, e.message)
                        resetState()
                    }
                }
            }
            return
        }

        // 앱에서는 항상 전송, DB upsert ignoreDuplicates로 중복 처리
        scope.launch {
            try {
                SignalApiClient.sendSignals(applicationContext, all)
                Log.i(TAG, "Signals sent successfully: ${all.size}")
                withContext(Dispatchers.Main) {
                    onScrapingResult?.invoke(bc, sc, true, null)
                    resetState()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Send failed, queuing", e)
                SignalQueueManager.enqueue(applicationContext, all)
                withContext(Dispatchers.Main) {
                    onScrapingResult?.invoke(bc, sc, false, e.message)
                    resetState()
                }
            }
        }
    }

    /**
     * 60초 워치독: 스크래핑이 너무 오래 걸리면 자동 취소 및 상태 리셋
     * 진행 중인 데이터가 있으면 저장 시도 후 종료
     */
    private fun onScrapingWatchdog() {
        if (state == State.IDLE || state == State.COMPLETED || state == State.FAILED) return

        Log.w(TAG, "Scraping watchdog triggered in state=$state after ${SCRAPING_WATCHDOG_MS}ms")

        // 스크래핑 중 데이터가 있으면 저장 시도
        if (buySignals.isNotEmpty() || sellSignals.isNotEmpty()) {
            Log.i(TAG, "Watchdog: partial data exists (${buySignals.size} buys, ${sellSignals.size} sells), completing")
            reportErrorHeartbeat("Watchdog timeout in $state after ${SCRAPING_WATCHDOG_MS}ms (partial: ${buySignals.size}+${sellSignals.size})")
            onComplete()
        } else {
            reportErrorHeartbeat("Watchdog timeout in $state after ${SCRAPING_WATCHDOG_MS}ms (no data)")
            fail("Scraping watchdog timeout in $state")
        }
    }

    /**
     * 하트비트 API에 에러 상태 전송
     */
    private fun reportErrorHeartbeat(errorMessage: String) {
        scope.launch {
            try {
                val now = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Seoul"))
                    .format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME)

                val hb = mapOf(
                    "device_id" to com.dashboardstock.collector.BuildConfig.DEVICE_ID,
                    "status" to "error",
                    "timestamp" to now,
                    "error_message" to errorMessage
                )

                val gson = com.google.gson.Gson()
                val jsonType = "application/json; charset=utf-8".toMediaType()
                val body = gson.toJson(hb).toRequestBody(jsonType)

                val url = "${com.dashboardstock.collector.BuildConfig.SUPABASE_URL}/rest/v1/collector_heartbeats"
                val request = okhttp3.Request.Builder()
                    .url(url)
                    .header("apikey", com.dashboardstock.collector.BuildConfig.SUPABASE_ANON_KEY)
                    .header("Authorization", "Bearer ${com.dashboardstock.collector.BuildConfig.SUPABASE_ANON_KEY}")
                    .header("Content-Type", "application/json")
                    .post(body)
                    .build()

                okhttp3.OkHttpClient().newCall(request).execute().close()
                Log.i(TAG, "Error heartbeat sent: $errorMessage")
            } catch (e: Exception) {
                Log.w(TAG, "Error heartbeat failed", e)
            }
        }
    }

    private fun onStepTimeout() {
        Log.w(TAG, "Step timeout in $state")
        when (state) {
            State.LAUNCHING_APP, State.CLICKING_AI_SIGNAL, State.WAITING_SIGNAL -> {
                // 앱 로딩/메뉴 클릭 지연 — 한번 더 대기
                handler.postDelayed(stepTimeoutRunnable, STEP_TIMEOUT_MS)
            }
            State.CLICKING_BUY -> {
                // 클릭 실패 → 현재 화면에서 파싱 시도
                transitionTo(State.SCRAPING_BUY)
                processState()
            }
            State.CLICKING_SELL_TAB -> {
                // 매도 탭 전환 타임아웃 → 매도 파싱 시도
                seenSymbols.clear()
                transitionTo(State.SCRAPING_SELL)
                processState()
            }
            State.SCRAPING_BUY -> {
                Log.i(TAG, "Buy scraping timeout → switch to 매도 tab")
                noNewCount = 0
                scrollCount = 0
                targetCount = 0
                val root = rootInActiveWindow
                if (root != null) {
                    switchToSellTab(root)
                    root.recycle()
                } else {
                    // root 없으면 바로 매도 파싱 시도
                    seenSymbols.clear()
                    transitionTo(State.SCRAPING_SELL)
                }
            }
            State.SCRAPING_SELL -> {
                onComplete()
            }
            else -> {}
        }
    }

    private fun onOverallTimeout() {
        Log.e(TAG, "Overall timeout")
        reportErrorHeartbeat("Overall timeout in $state (buys=${buySignals.size}, sells=${sellSignals.size})")
        if (buySignals.isNotEmpty() || sellSignals.isNotEmpty()) {
            onComplete()
        } else {
            fail("Overall timeout with no data")
        }
    }

    private fun fail(reason: String) {
        Log.e(TAG, "FAILED: $reason")
        handler.removeCallbacksAndMessages(null)
        transitionTo(State.FAILED)
        reportErrorHeartbeat(reason)
        onScrapingResult?.invoke(0, 0, false, reason)
        resetState()
    }

    private fun resetState() {
        state = State.IDLE
        isScrapingActive = false
        handler.removeCallbacks(scrapingWatchdogRunnable)
        buySignals.clear()
        sellSignals.clear()
        seenSymbols.clear()
        noNewCount = 0
        clickAttempt = 0
        debouncing = false
        waiting = false
    }
}
