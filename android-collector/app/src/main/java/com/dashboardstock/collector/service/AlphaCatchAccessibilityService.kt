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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

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
        // 스크래핑 도중 서비스가 내려가면 onInterrupt·단계 타임아웃·fail 이 모두 실행되지 않아
        // 서버에 아무 흔적도 남지 않습니다. 사용자가 접근성 서비스를 끄거나 시스템이 재바인딩하는
        // 경로가 여기에 해당합니다.
        //
        // 하트비트 전송은 SignalApiClient.heartbeatScope 가 담당해 서비스 scope 와 분리되어 있으므로
        // scope.cancel() 이후에도 완주합니다. 다만 isScrapingActive 를 내리기 전에 읽어야 하고
        // handler 를 비우기 전에 state 를 읽어야 하므로 정리 작업보다 먼저 실행합니다.
        //
        // COMPLETED/FAILED 는 이미 결과를 남긴 실행입니다. 전송이 IO 스레드에서 도는 수 초 동안
        // isScrapingActive 가 아직 true 라, state 를 함께 보지 않으면 정상 완료가 중단으로 기록됩니다.
        if (isScrapingActive && state != State.COMPLETED && state != State.FAILED) {
            SignalApiClient.reportHeartbeat("error", "알파캐치: 서비스 종료로 수집 중단(state=$state)")
        }
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
        // 수집 도중 중단되면 결과 콜백도 완료 하트비트도 남지 않으므로 여기서 알립니다.
        if (isScrapingActive) {
            SignalApiClient.reportHeartbeat("error", "알파캐치: 접근성 서비스 중단(state=$state)")
        }
        resetState()
    }

    /**
     * 스크래핑 시작
     *
     * COMPLETED/FAILED 는 직전 실행이 남긴 잔여 상태일 뿐이므로 IDLE 과 동일하게 취급합니다.
     * 전송 구간에서 scope 가 취소되면 [resetState] 가 실행되지 않아 state 가 COMPLETED 로 고착되고,
     * 다음 날 17시 알람이 조기 반환으로 사라져 수집이 통째로 누락됐습니다. 새 실행을 막을 이유가
     * 있는 상태는 실제 진행 중인 단계(LAUNCHING_APP~SCRAPING)뿐입니다.
     */
    fun startScraping() {
        if (state != State.IDLE && state != State.COMPLETED && state != State.FAILED) {
            // 조기 반환이 로그만 남기면 그날 수집이 빠져도 대시보드는 직전 성공을 계속 보여 줍니다.
            Log.w(TAG, "Already scraping: $state")
            SignalApiClient.reportHeartbeat(
                "error",
                "알파캐치: 이전 수집이 진행 중이라 시작하지 못했습니다(state=$state)"
            )
            return
        }
        if (state != State.IDLE) {
            Log.w(TAG, "Stale state=$state — 잔여 상태를 정리하고 새로 시작합니다")
        }

        Log.i(TAG, "=== AlphaCatch scraping start ===")
        // 직전 실행이 남긴 지연 콜백(예약된 resetState)이 새 실행 도중 버퍼를 비우지 못하게
        // 먼저 비웁니다. resetState 는 상태·버퍼 초기화를 한곳에 모아 둔 것을 재사용합니다.
        handler.removeCallbacksAndMessages(null)
        resetState()
        isScrapingActive = true

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

        if (canFinish) {
            onComplete()
            return
        }
        if (scrollCount >= MAX_SCROLL) {
            // 보유 종목 섹션 끝을 확인하지 못한 채 스크롤 상한에 걸린 경우입니다. 목록이 잘렸을 수
            // 있으므로 정상 종료(note = null)로 보고하지 않습니다.
            onComplete("최대 스크롤 도달(${MAX_SCROLL}회)")
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

    /**
     * @param note 정상 종료가 아닌 경로(타임아웃, 스크롤 상한)로 들어온 경우의 사유.
     *             하트비트에 함께 남기고 보유 종목 전량 교체 여부를 가르는 기준으로도 씁니다.
     */
    private fun onComplete(note: String? = null) {
        handler.removeCallbacksAndMessages(null)
        transitionTo(State.COMPLETED)
        performGlobalAction(GLOBAL_ACTION_HOME)

        // resetState 가 리스트를 비우므로 건수와 전송 목록은 코루틴 진입 전에 확정합니다.
        val signals = buySignals + sellSignals
        val holdingsSnapshot = holdings.toList()
        val buyCount = buySignals.size
        val sellCount = sellSignals.size
        val holdCount = holdings.size

        // note == null 은 [onScraping] 의 정상 종료 조건("보유 종목" 섹션 확인 + 신규 0건)을 통과한
        // 실행뿐입니다. 보유 종목 전송은 DELETE 후 INSERT 하는 전량 교체라, 타임아웃으로 화면 일부만
        // 긁은 부분 수집본으로 교체하면 아직 스크롤이 닿지 않은 종목이 서버에서 사라집니다.
        // 보유 종목 섹션은 화면 최하단이라 부분 수집일수록 목록이 잘릴 확률이 높습니다.
        // 목록 끝을 확인한 실행에서만 갱신하고, 그 외에는 직전 스냅샷을 유지합니다.
        val holdingsComplete = note == null

        val summary = "buy=$buyCount sell=$sellCount hold=$holdCount" +
                (note?.let { " ($it)" } ?: "")
        Log.i(TAG, "Done: $summary")

        scope.launch {
            try {
                if (signals.isNotEmpty()) {
                    SignalApiClient.sendSignals(applicationContext, signals)
                }
                if (holdingsComplete) {
                    SignalApiClient.sendAlphaCatchHoldings(holdingsSnapshot)
                } else {
                    Log.w(TAG, "Holdings sync skipped (부분 수집): hold=$holdCount, note=$note")
                }
                reportCompletionHeartbeat(buyCount, sellCount, holdCount, summary, note, holdingsComplete)
                finishRun(buyCount, sellCount, holdCount, true, null)
            } catch (e: CancellationException) {
                // onDestroy 의 scope.cancel() 로 인한 취소입니다. 전송이 모두 끝난 뒤에 오는 경우가
                // 많은데, 이를 실패로 기록하면 heartbeatScope 는 살아 있어 실제로 전송되고
                // 성공한 수집이 대시보드에 붉은 오류로 표시됩니다. 기록하지 않고 그대로 전파합니다.
                // 서비스 종료 자체는 onDestroy 가 error 하트비트로 남깁니다.
                Log.w(TAG, "Send cancelled — 서비스 종료로 중단되었습니다 ($summary)")
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Send failed", e)
                SignalApiClient.reportHeartbeat("error", "알파캐치: 전송 실패 — ${e.message} ($summary)")
                finishRun(buyCount, sellCount, holdCount, false, e.message)
            }
        }
    }

    /**
     * 결과 콜백과 상태 리셋을 메인 스레드에서 실행합니다.
     *
     * withContext(Dispatchers.Main) 으로 실행하면 scope 가 취소된 뒤에는 아예 실행되지 않아
     * state 가 COMPLETED 로 고착됩니다. Handler 는 서비스 scope 수명과 무관하므로 취소 이후에도
     * 예약된 작업이 실행됩니다.
     */
    private fun finishRun(buy: Int, sell: Int, hold: Int, ok: Boolean, err: String?) {
        handler.post {
            onScrapingResult?.invoke(buy, sell, hold, ok, err)
            // 전송은 최대 수십 초가 걸립니다. 그 사이 새 실행이 시작됐다면 state 는 진행 단계로
            // 바뀌어 있으므로, 이전 실행의 뒤늦은 초기화가 새 실행의 상태와 버퍼를 지우지 않게 합니다.
            if (state == State.COMPLETED || state == State.FAILED) {
                resetState()
            } else {
                Log.w(TAG, "새 실행이 진행 중이라 이전 실행의 상태 초기화를 건너뜁니다 (state=$state)")
            }
        }
    }

    /**
     * 완료 경로 하트비트
     *
     * 판단 근거는 다음과 같습니다. 매수·매도 신호는 실제로 0건인 날이 있어 신호 0건만으로 error 를
     * 올리면 오탐이 됩니다. 반면 알파추천 화면에는 보유 종목 섹션이 상시 노출되고 [onScraping] 의
     * 정상 종료 조건도 "보유 종목" 섹션 확인을 전제로 하므로, 매수·매도·보유가 모두 0이면 화면 진입
     * 또는 파싱 실패로 봅니다. 서버 크론(/api/v1/cron/lassi-signals)도 0건을 이상 징후로 기록합니다.
     *
     * 신호 0건이고 보유만 잡힌 경우는 status=active 로 두되 요약 문구를 남깁니다.
     * collector_heartbeats 에 수집 주체 컬럼이 없으므로, 그날 알파캐치가 돌았는지는 이 문구로만
     * 서버에서 구분할 수 있습니다.
     *
     * 완전한 정상 종료(note = null, 신호 전송 있음)에서는 SignalApiClient.sendSignals 가 남긴
     * active 하트비트로 충분하므로 아무것도 보내지 않습니다. error_message 는 대시보드에서 붉은
     * "오류:" 줄로 보이므로 정상일 때는 비워 둡니다.
     *
     * 다만 [note] 가 있는 비정상 종료에서는 신호를 보냈더라도 한 건을 더 남깁니다. 기록이 2건이
     * 되는 것은 의도입니다. 대시보드(web/src/app/collector/page.tsx)는 collector_devices_latest
     * 뷰로 기기별 최신 1건만 읽으므로, 나중에 들어간 이 행이 화면에 표시됩니다. 이 행이 없으면
     * 타임아웃·스크롤 상한으로 목록이 잘린 실행이 완전한 성공과 구분되지 않습니다.
     * markSignal 을 함께 세우는 이유도 같습니다. 최신 1건만 보이는 구조라 last_signal 을 비우면
     * sendSignals 가 채워 둔 신호 시각이 화면에서 사라집니다.
     *
     * 보유 0건도 한 건 남깁니다. 전량 교체를 건너뛰어 서버 보유 목록이 직전 스냅샷 그대로 남는데,
     * 이를 알리지 않으면 파싱이 깨진 채 며칠이 지나도 대시보드가 정상으로 보입니다.
     *
     * @param holdingsComplete 보유 종목 전량 교체를 실제로 수행했는지 여부. 건너뛴 실행은 서버의
     *                         보유 목록이 직전 스냅샷이라는 사실을 문구로 남깁니다.
     */
    private fun reportCompletionHeartbeat(
        buyCount: Int,
        sellCount: Int,
        holdCount: Int,
        summary: String,
        note: String?,
        holdingsComplete: Boolean
    ) {
        val holdingsNote = if (holdingsComplete) "" else ", 보유 갱신 건너뜀"

        when {
            buyCount + sellCount + holdCount == 0 ->
                SignalApiClient.reportHeartbeat("error", "알파캐치: 수집 0건 — $summary")

            buyCount + sellCount == 0 ->
                SignalApiClient.reportHeartbeat(
                    "active",
                    "알파캐치: 신호 0건, 보유만 수집$holdingsNote — $summary"
                )

            holdCount == 0 ->
                SignalApiClient.reportHeartbeat(
                    "active",
                    "알파캐치: 보유 0건 — 보유 목록 갱신 건너뜀(직전 스냅샷 유지) — $summary",
                    markSignal = true
                )

            note != null ->
                SignalApiClient.reportHeartbeat(
                    "active",
                    "알파캐치: 비정상 종료$holdingsNote — $summary",
                    markSignal = true
                )

            else -> Unit
        }
    }

    private fun onStepTimeout() {
        Log.w(TAG, "Step timeout in $state")
        when (state) {
            State.SCRAPING -> onComplete("단계 타임아웃(state=$state)")
            else -> fail("단계 타임아웃(state=$state)")
        }
    }

    private fun onOverallTimeout() {
        Log.e(TAG, "Overall timeout")
        if (buySignals.isNotEmpty() || sellSignals.isNotEmpty() || holdings.isNotEmpty()) {
            onComplete("전체 타임아웃 — 부분 수집(state=$state)")
        } else {
            fail("전체 타임아웃(state=$state)")
        }
    }

    private fun fail(reason: String) {
        Log.e(TAG, "FAILED: $reason")
        handler.removeCallbacksAndMessages(null)
        transitionTo(State.FAILED)
        // onScrapingResult 는 StatusActivity 가 열려 있을 때만 붙으므로, 알람 자동 실행 실패는
        // 하트비트를 남기지 않으면 서버에서 보이지 않습니다.
        SignalApiClient.reportHeartbeat("error", "알파캐치: $reason")
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
