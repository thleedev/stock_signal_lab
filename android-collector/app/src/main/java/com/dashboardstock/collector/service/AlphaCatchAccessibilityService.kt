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
import com.dashboardstock.collector.api.AlphaCatchHoldingInput
import com.dashboardstock.collector.api.SignalApiClient
import com.dashboardstock.collector.api.SignalInput
import com.dashboardstock.collector.parser.AlphaCatchScreenParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 영웅문 알파캐치 → 알파추천 화면 스크래핑 AccessibilityService
 *
 * 흐름: IDLE → LAUNCHING_APP → CLICKING_ALPHACATCH_TAB
 *       → CLICKING_ALPHA_RECOMMEND → SCRAPING → COMPLETED
 *
 * 한 화면(매매 신호 탭)에 매수신호/매도신호/보유종목 3섹션이 세로로 쌓임.
 * 스크롤하며 모든 섹션의 데이터 누적 수집.
 *
 * 라씨와 별도 서비스로 둠 (상태머신·진입경로·파싱 모두 다름).
 */
class AlphaCatchAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AlphaCatchA11y"
        private const val KIWOOM_PACKAGE = "com.kiwoom.heromts"
        private const val STEP_TIMEOUT_MS = 15000L
        private const val OVERALL_TIMEOUT_MS = 300000L  // 5분
        private const val MAX_SCROLL = 30

        @Volatile
        var instance: AlphaCatchAccessibilityService? = null
            private set

        @Volatile
        var isScrapingActive: Boolean = false
            private set

        var onScrapingResult: ((buy: Int, sell: Int, hold: Int, ok: Boolean, err: String?) -> Unit)? = null
    }

    enum class State {
        IDLE,
        LAUNCHING_APP,
        CLICKING_ALPHACATCH_TAB,
        CLICKING_ALPHA_RECOMMEND,
        SCRAPING,
        COMPLETED,
        FAILED
    }

    private var state = State.IDLE
    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val buySignals = mutableListOf<SignalInput>()
    private val sellSignals = mutableListOf<SignalInput>()
    private val holdings = mutableListOf<AlphaCatchHoldingInput>()
    private val seenBuyKeys = mutableSetOf<String>()
    private val seenSellKeys = mutableSetOf<String>()
    private val seenHoldNames = mutableSetOf<String>()
    private var scrollCount = 0
    private var clickAttempt = 0
    private var debouncing = false
    private var waiting = false

    private val stepTimeoutRunnable = Runnable { onStepTimeout() }
    private val overallTimeoutRunnable = Runnable { onOverallTimeout() }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "AlphaCatch service connected")
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
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> scheduleProcess()
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Service interrupted")
        resetState()
    }

    fun startScraping() {
        if (state != State.IDLE) {
            Log.w(TAG, "Already scraping: $state")
            return
        }
        Log.i(TAG, "=== AlphaCatch scraping start ===")
        isScrapingActive = true
        buySignals.clear(); sellSignals.clear(); holdings.clear()
        seenBuyKeys.clear(); seenSellKeys.clear(); seenHoldNames.clear()
        scrollCount = 0; clickAttempt = 0; waiting = false

        handler.postDelayed(overallTimeoutRunnable, OVERALL_TIMEOUT_MS)
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
                State.CLICKING_ALPHACATCH_TAB -> onClickingAlphaCatchTab(root)
                State.CLICKING_ALPHA_RECOMMEND -> onClickingAlphaRecommend(root)
                State.SCRAPING -> onScraping(root)
                else -> {}
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in $state", e)
        } finally {
            root.recycle()
        }
    }

    /** 키움앱 로드 후 → 하단 "알파캐치" 탭 클릭 단계로 */
    private fun onLaunchingApp(root: AccessibilityNodeInfo) {
        if (KiwoomAccessibilityService.isScrapingActive) {
            Log.w(TAG, "Lassi scraping active, deferring")
            handler.postDelayed({ processState() }, 2000)
            return
        }

        val texts = collectTexts(root)
        // 하단 탭바에 "알파캐치" 텍스트가 보이면 앱 로드 완료로 간주
        if (texts.any { it == "알파캐치" }) {
            clickAttempt = 0
            transitionTo(State.CLICKING_ALPHACATCH_TAB)
            handler.postDelayed({ processState() }, 500)
        }
    }

    /** 하단 "알파캐치" 탭 클릭 */
    private fun onClickingAlphaCatchTab(root: AccessibilityNodeInfo) {
        clickAttempt++
        // 화면 하단 영역의 "알파캐치" 텍스트 노드 찾기 (Y가 가장 큰 것)
        val candidates = findAllTextNodes(root, "알파캐치")
        val target = candidates.maxByOrNull { it.second.centerY() }
        if (target != null) {
            val (node, rect) = target
            Log.i(TAG, "Clicking bottom 알파캐치 tab at $rect")
            clickWithMultiStrategy(node, rect)
            for ((n, _) in candidates) n.recycle()
            waiting = true
            handler.postDelayed({
                waiting = false
                clickAttempt = 0
                transitionTo(State.CLICKING_ALPHA_RECOMMEND)
                processState()
            }, 1500)
        } else if (clickAttempt < 3) {
            handler.postDelayed({ processState() }, 1500)
        } else {
            // 못찾으면 바로 알파추천 시도
            Log.w(TAG, "알파캐치 tab not found, skipping to ALPHA_RECOMMEND")
            transitionTo(State.CLICKING_ALPHA_RECOMMEND)
            processState()
        }
    }

    /** 상단 "알파추천" 클릭 */
    private fun onClickingAlphaRecommend(root: AccessibilityNodeInfo) {
        clickAttempt++
        val texts = collectTexts(root)
        // 매수/매도/보유종목 섹션이 이미 보이면 진입 성공
        if (texts.any { it == "매수 신호" } || texts.any { it == "보유 종목" }) {
            Log.i(TAG, "Already on 알파추천 screen → SCRAPING")
            transitionTo(State.SCRAPING)
            handler.postDelayed({ processState() }, 800)
            return
        }
        val node = findTextNode(root, "알파추천")
        if (node != null) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            Log.i(TAG, "Clicking 알파추천 at $rect")
            clickWithMultiStrategy(node, rect)
            node.recycle()
            waiting = true
            handler.postDelayed({
                waiting = false
                clickAttempt = 0
                transitionTo(State.SCRAPING)
                processState()
            }, 1500)
        } else if (clickAttempt < 3) {
            handler.postDelayed({ processState() }, 1500)
        } else {
            fail("알파추천 메뉴 진입 실패")
        }
    }

    /** 한 페이지 파싱 + 누적 + 스크롤. "보유 종목" 섹션 끝까지 도달하면 종료 */
    private fun onScraping(root: AccessibilityNodeInfo) {
        val result = AlphaCatchScreenParser.parseVisibleNodes(root)
        var newCount = 0

        for (s in result.buySignals) {
            val key = "${s.name}|${s.signalPrice}"
            if (seenBuyKeys.add(key)) { buySignals.add(s); newCount++ }
        }
        for (s in result.sellSignals) {
            val key = "${s.name}|${s.signalPrice}"
            if (seenSellKeys.add(key)) { sellSignals.add(s); newCount++ }
        }
        for (h in result.holdings) {
            if (seenHoldNames.add(h.name)) { holdings.add(h); newCount++ }
        }

        Log.d(TAG, "Scrape #$scrollCount: new=$newCount, total b=${buySignals.size} s=${sellSignals.size} h=${holdings.size}")

        // 종료 조건: 화면에 보유종목 섹션이 노출되었고, 최근 2회 스크롤에서 새 데이터가 없으면 끝
        val texts = collectTexts(root)
        val sawHoldingSection = texts.any { it == "보유 종목" }
        val canFinish = sawHoldingSection && newCount == 0 && scrollCount > 0

        if (canFinish || scrollCount >= MAX_SCROLL) {
            onComplete()
            return
        }

        scrollCount++
        handler.removeCallbacks(stepTimeoutRunnable)
        handler.postDelayed(stepTimeoutRunnable, STEP_TIMEOUT_MS)
        scrollDown()
        waiting = true
        handler.postDelayed({
            waiting = false
            processState()
        }, 600)
    }

    private fun scrollDown() {
        val cx = resources.displayMetrics.widthPixels / 2f
        val startY = resources.displayMetrics.heightPixels * 0.75f
        val endY = resources.displayMetrics.heightPixels * 0.25f
        val path = Path().apply { moveTo(cx, startY); lineTo(cx, endY) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        dispatchGesture(gesture, null, null)
    }

    private fun launchKiwoomApp() {
        val intent = packageManager.getLaunchIntentForPackage(KIWOOM_PACKAGE)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            startActivity(intent)
        } else {
            fail("Kiwoom app not installed")
        }
    }

    private fun onComplete() {
        handler.removeCallbacksAndMessages(null)
        transitionTo(State.COMPLETED)
        performGlobalAction(GLOBAL_ACTION_HOME)

        Log.i(TAG, "Done: buy=${buySignals.size}, sell=${sellSignals.size}, hold=${holdings.size}")

        scope.launch {
            try {
                val all = buySignals + sellSignals
                if (all.isNotEmpty()) {
                    SignalApiClient.sendSignals(applicationContext, all)
                }
                SignalApiClient.sendAlphaCatchHoldings(holdings)
                withContext(Dispatchers.Main) {
                    onScrapingResult?.invoke(buySignals.size, sellSignals.size, holdings.size, true, null)
                    resetState()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Send failed", e)
                withContext(Dispatchers.Main) {
                    onScrapingResult?.invoke(buySignals.size, sellSignals.size, holdings.size, false, e.message)
                    resetState()
                }
            }
        }
    }

    private fun onStepTimeout() {
        Log.w(TAG, "Step timeout in $state")
        when (state) {
            State.SCRAPING -> onComplete()
            else -> fail("Step timeout in $state")
        }
    }

    private fun onOverallTimeout() {
        Log.e(TAG, "Overall timeout")
        if (buySignals.isNotEmpty() || sellSignals.isNotEmpty() || holdings.isNotEmpty()) {
            onComplete()
        } else {
            fail("Overall timeout")
        }
    }

    private fun fail(reason: String) {
        Log.e(TAG, "FAILED: $reason")
        handler.removeCallbacksAndMessages(null)
        transitionTo(State.FAILED)
        onScrapingResult?.invoke(0, 0, 0, false, reason)
        resetState()
    }

    private fun resetState() {
        state = State.IDLE
        isScrapingActive = false
        buySignals.clear(); sellSignals.clear(); holdings.clear()
        seenBuyKeys.clear(); seenSellKeys.clear(); seenHoldNames.clear()
        scrollCount = 0; clickAttempt = 0; debouncing = false; waiting = false
    }

    // ===== 공통 유틸 =====

    private fun clickWithMultiStrategy(node: AccessibilityNodeInfo, rect: Rect) {
        if (node.isClickable) {
            try {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                return
            } catch (_: Exception) {}
        }
        performTap(rect.centerX().toFloat(), rect.centerY().toFloat(), 150)
    }

    private fun performTap(x: Float, y: Float, durationMs: Long) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        dispatchGesture(gesture, null, null)
    }

    private fun collectTexts(node: AccessibilityNodeInfo): List<String> {
        val result = mutableListOf<String>()
        collectTextsRecursive(node, result)
        return result
    }

    private fun collectTextsRecursive(node: AccessibilityNodeInfo, out: MutableList<String>) {
        node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectTextsRecursive(child, out)
            child.recycle()
        }
    }

    private fun findTextNode(node: AccessibilityNodeInfo, text: String): AccessibilityNodeInfo? {
        if (node.text?.toString()?.trim() == text) return AccessibilityNodeInfo.obtain(node)
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findTextNode(child, text)
            if (found != null) { child.recycle(); return found }
            child.recycle()
        }
        return null
    }

    private fun findAllTextNodes(root: AccessibilityNodeInfo, text: String): List<Pair<AccessibilityNodeInfo, Rect>> {
        val result = mutableListOf<Pair<AccessibilityNodeInfo, Rect>>()
        findAllTextNodesRecursive(root, text, result)
        return result
    }

    private fun findAllTextNodesRecursive(
        node: AccessibilityNodeInfo,
        text: String,
        out: MutableList<Pair<AccessibilityNodeInfo, Rect>>
    ) {
        if (node.text?.toString()?.trim() == text) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            out.add(Pair(AccessibilityNodeInfo.obtain(node), rect))
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            findAllTextNodesRecursive(child, text, out)
            child.recycle()
        }
    }
}
