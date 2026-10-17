const { GoogleGenAI, ThinkingLevel } = require('@google/genai');
const { BrowserWindow, ipcMain, net, shell } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt, buildMeetingContextBlock, CODING_ANSWER_INSTRUCTION } = require('./prompts');
const {
    getApiKey,
    getGroqApiKey,
    getOpenRouterApiKey,
    incrementCharUsage,
    getModelForToday,
    getPreferences,
    startSessionArchive,
    appendSessionRecord,
    flushSessionArchive,
    getArchivedSession,
} = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');
const { captureScreenStill } = require('./screenStill');
const { SENSITIVITY, announcesShare, decideScreen } = require('./screenDecision');
const {
    chooseAnalyzeScreenPath,
    sendForcedLiveScreenTurn,
    buildScreenAnalysisRequest,
    buildLiveScreenContextContent,
} = require('./analyzeScreenSend');
const { BoundedAudioQueue, validateAudioFrame } = require('./audioPipeline');
const { ConnectionGeneration } = require('./connectionGeneration');
const { createTurnId, emitAnswer } = require('./answerEvents');
const { buildRelevantContext } = require('./historyStore');
const { connectGeminiLive } = require('./geminiLiveTransport');
const { buildGeminiLiveSessionConfig, isLiveServerInterrupt } = require('./geminiLiveSessionConfig');
const { LiveAudioGapFiller } = require('./liveAudioGapFiller');
const { LiveTurnWatchdog } = require('./liveTurnWatchdog');
const { formatLiveAnswerText, formatAnswerForDisplay } = require('./answerFormatting');
const { nextVoiceQuestion, questionText } = require('./questionMerge');
const { streamOpenRouterAnswer, answerWithFallback, toGeminiContents, answerModelById } = require('./answerModel');
const { LANE_INSTRUCTION, parseLaneHeader, splitSideUpdate, isReplaceableAnswer, resolveLane, isBackchannel } = require('./answerLanes');
const { CODING_COMMANDS, EXIT_WORDS, NEW_PROBLEM_WORDS, loadCodingSkill, ensureUserSkillFile, CodingSession } = require('./codingSession');

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'cloud', or 'local'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let currentSystemPrompt = null;
let conversationSequence = 0;
let screenSequence = 0;
let transcriptSequence = 0;
let currentSummary = '';
let completedTurnsSinceSummary = 0;
let lastSummaryAt = 0;
let summaryInFlight = false;

const GEMINI_LIVE_MODEL = 'gemini-3.8-live';

/** @param {string} prefix @param {{turnId?:string, sequenceBase?:number, lane?:'main'|'side', label?:string, focus?:boolean}} [options] */
function createAnswerStream(prefix, { turnId = createTurnId(prefix), sequenceBase = 0, lane = 'main', label = '', focus = true } = {}) {
    let sequence = sequenceBase;
    let started = false;
    const meta = { lane, label, focus };
    return {
        update(text) {
            emitAnswer(sendToRenderer, turnId, started ? 'update' : 'start', text, sequence++, meta);
            started = true;
        },
        complete(text, status = 'complete') {
            emitAnswer(sendToRenderer, turnId, status, text, sequence++, meta);
        },
    };
}

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = `Speaker ${result.speakerId}`;
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// 3.1 delivers one full utterance (or a cumulative snapshot), not 2.5-style
// character deltas. Replace when the new text is the same turn growing;
// append only when it is a genuinely new fragment.
function mergeLiveInputTranscription(previous, incoming) {
    const next = String(incoming || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!next) {
        return previous || '';
    }
    const prev = String(previous || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!prev) {
        return next;
    }
    if (next === prev) {
        return prev;
    }
    if (next.startsWith(prev)) {
        return next;
    }
    if (prev.startsWith(next)) {
        return prev;
    }
    return `${prev} ${next}`;
}

function ingestLiveInputTranscription(message) {
    const input = message.serverContent?.inputTranscription;
    if (!input) {
        return false;
    }

    let incoming = '';
    if (input.results?.length) {
        incoming = formatSpeakerResults(input.results);
    } else if (input.text) {
        incoming = input.text;
    }
    if (!incoming.trim()) {
        return false;
    }

    currentTranscription = mergeLiveInputTranscription(currentTranscription, incoming);
    return true;
}

function ingestLiveOutputTranscription(message) {
    const incoming = message.serverContent?.outputTranscription?.text;
    if (!incoming || !String(incoming).trim()) {
        return false;
    }

    liveOutputText = mergeLiveInputTranscription(liveOutputText, incoming);
    liveTurnWatchdog.outputReceived();
    // In BYOK the text model writes the visible answer. Live's spoken reply stays hidden unless that answer fails.
    if (textAnswersEnabled() && !liveAnswerFallbackPending) return true;
    if (!liveTurnId) liveTurnId = createTurnId('live');
    emitAnswer(sendToRenderer, liveTurnId, liveOutputStarted ? 'update' : 'start', formatLiveAnswerText(liveOutputText), liveOutputSequence++);
    liveOutputStarted = true;
    sendToRenderer('update-status', 'Responding...');
    return true;
}

function finalizeLiveConversationTurn() {
    liveTurnWatchdog.turnEnded();
    const input = currentTranscription.trim();
    const output = formatLiveAnswerText(liveOutputText);
    if (input && !output) liveUnansweredTurns++;
    liveInputTurnSeq++;
    if (input) rememberHeard(input);
    if (input && currentSessionId) {
        appendSessionRecord(currentSessionId, {
            id: `${currentSessionId}:transcript:${++transcriptSequence}`,
            type: 'transcript',
            timestamp: Date.now(),
            transcription: input,
        }).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
    }
    if (output && (!textAnswersEnabled() || liveAnswerFallbackPending)) {
        if (!liveTurnId) liveTurnId = createTurnId('live');
        emitAnswer(sendToRenderer, liveTurnId, 'complete', output, liveOutputSequence++);
        saveConversationTurn(input || '(audio)', output);
        liveAnswerFallbackPending = false;
    }
    currentTranscription = '';
    liveOutputText = '';
    liveOutputStarted = false;
    liveTurnId = null;
    liveOutputSequence = 0;
    messageBuffer = '';
    awaitingLateTranscript = false;
}

function resetLiveConversationBuffers() {
    liveTurnWatchdog.turnEnded();
    stalledTurnPending = false;
    liveInputTurnSeq++;
    currentTranscription = '';
    liveOutputText = '';
    liveOutputStarted = false;
    liveTurnId = null;
    liveOutputSequence = 0;
    messageBuffer = '';
    awaitingLateTranscript = false;
    clearTranscriptionSilenceTimer();
    clearLateTranscriptionTimer();
}

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

// Gemini audio send serialization
let geminiSendLock = false;
const geminiAudioQueue = new BoundedAudioQueue({
    sampleRate: 16000,
    maxDurationMs: 2000,
    onGap: gap => console.warn('Dropped stale Gemini audio frame:', gap.sequence),
});
let geminiAudioSequence = 0;
let congestionStartedAt = 0;
let congestionRetryTimer = null;
let liveResampleRemainder = Buffer.alloc(0);
const liveGapFiller = new LiveAudioGapFiller({
    onFill: pcm => {
        if (currentProviderMode === 'byok' && global.geminiSessionRef?.current) enqueueLivePcm(pcm, 16000, global.geminiSessionRef, true);
    },
});
let sessionResumptionHandle = null;
let reconnectInFlight = false;
const liveConnections = new ConnectionGeneration();
let pendingLiveImage = null;
let liveImageSendInFlight = false;
let lastScreenshotJpeg = null;
let pendingTypedQuestion = null;
let liveTurnId = null;
let liveOutputSequence = 0;
// Set when the watchdog finished a turn itself; the stalled turn's late interrupted/turnComplete is then ignored.
let stalledTurnPending = false;
let liveUnansweredTurns = 0;
let liveStalledTurns = 0;
const liveTurnWatchdog = new LiveTurnWatchdog({
    onStall: () => {
        console.warn('Gemini Live answer stalled without turnComplete; finishing the turn');
        liveStalledTurns++;
        stalledTurnPending = true;
        finalizeLiveConversationTurn();
        sendToRenderer('update-status', 'Listening...');
    },
});
global.getMeetingDiagnostics = () => {
    const gaps = liveGapFiller.stats();
    return {
        providerMode: currentProviderMode,
        audioQueueFrames: geminiAudioQueue.length,
        audioQueueMs: Math.round(geminiAudioQueue.durationMs),
        reconnecting: reconnectInFlight,
        summaryRunning: summaryInFlight,
        audioGapsFilled: gaps.gapsFilled,
        longestAudioGapMs: gaps.longestGapMs,
        liveUnansweredTurns,
        liveStalledTurns,
    };
};

// 3.1 batches inputTranscription after the utterance, so this timer starts
// once the full text arrives — not mid-sentence like 2.5 incremental chunks.
function clientSilenceTimeoutMs() {
    return getPreferences().vadPreset === 'patient' ? 900 : 600;
}
const LATE_TRANSCRIPT_MS = 800;
let transcriptionSilenceTimer = null;
let lateTranscriptionTimer = null;
let awaitingLateTranscript = false;
let liveOutputText = '';
let liveOutputStarted = false;

// Groq Whisper VAD state
const WHISPER_SILENCE_THRESHOLD = 0.008; // RMS energy below this = silence
const WHISPER_SPEECH_START_FRAMES = 3; // consecutive speech frames to start recording
const WHISPER_SILENCE_END_FRAMES = 10; // consecutive silence frames (~1s) to end utterance
const WHISPER_PRE_BUFFER_FRAMES = 5; // frames before speech start to include
let whisperIsSpeaking = false;
let whisperSpeechFrames = 0;
let whisperSilenceFrames = 0;
let whisperAudioBuffer = []; // Buffers during active speech
let whisperPreBuffer = []; // Rolling pre-speech buffer (last N frames)
let whisperAudioBytes = 0;
let whisperJobs = [];
let whisperJobActive = false;
let whisperJobGeneration = 0;
let previousWhisperTranscript = '';
const MAX_WHISPER_SEGMENT_BYTES = 16000 * 2 * 20;
const WHISPER_OVERLAP_BYTES = 16000;

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
let reconnectStartedAt = 0;
const MAX_RECONNECT_MS = 60000;

function isFatalConnectionClose(event) {
    return event?.code === 1008 || /auth|api.?key|permission|invalid argument|configuration/i.test(event?.reason || '');
}

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn => `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`);

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = Date.now().toString();
    answerSessionId = `cheating-daddy-${currentSessionId}`;
    // The start screen's model choice applies from the next session.
    answerModel = answerModelById(getPreferences().answerModel);
    cancelTextAnswers();
    conversationSequence = 0;
    screenSequence = 0;
    transcriptSequence = 0;
    resetLiveConversationBuffers();
    conversationHistory = [];
    screenAnalysisHistory = [];
    groqConversationHistory = [];
    lastScreenshotJpeg = null;
    pendingTypedQuestion = null;
    currentSummary = '';
    completedTurnsSinceSummary = 0;
    lastSummaryAt = 0;
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    startSessionArchive({
        sessionId: currentSessionId,
        profile,
        customPrompt: customPrompt || '',
    }).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
    console.log('New conversation session started:', currentSessionId, 'profile:', profile, 'answer model:', answerModel.id);
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const userSide = (pendingTypedQuestion || transcription || '').trim();
    pendingTypedQuestion = null;
    recordConversationTurn(userSide, aiResponse);
}

// Stores a turn without consuming pendingTypedQuestion (used by text answers).
function recordConversationTurn(userSide, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        id: `${currentSessionId}:turn:${++conversationSequence}`,
        type: 'turn',
        timestamp: Date.now(),
        transcription: userSide,
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    if (conversationHistory.length > 200) conversationHistory = conversationHistory.slice(-200);
    console.log('Saved conversation turn:', conversationTurn);

    appendSessionRecord(currentSessionId, conversationTurn).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
    completedTurnsSinceSummary++;
    scheduleMeetingSummary();
}

function scheduleMeetingSummary() {
    if (summaryInFlight || completedTurnsSinceSummary < 12 || (lastSummaryAt && Date.now() - lastSummaryAt < 5 * 60 * 1000)) return;
    const sessionId = currentSessionId;
    const turns = conversationHistory.slice(-12);
    const apiKey = getApiKey();
    if (!sessionId || !apiKey) return;
    summaryInFlight = true;
    Promise.resolve()
        .then(async () => {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `Update the structured meeting summary. Keep decisions, constraints, names, unresolved questions, and supporting turn IDs. Return concise plain text.\n\nPrevious summary:\n${currentSummary}\n\nNew turns:\n${JSON.stringify(turns)}`;
            const response = await ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents: prompt,
                config: { maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
            });
            const summary = String(response.text || '').trim();
            if (!summary || sessionId !== currentSessionId) return;
            currentSummary = summary;
            completedTurnsSinceSummary = 0;
            lastSummaryAt = Date.now();
            await appendSessionRecord(sessionId, {
                id: `${sessionId}:summary:${lastSummaryAt}`,
                type: 'summary',
                timestamp: lastSummaryAt,
                summary,
                supportingTurnIds: turns.map(turn => turn.id),
            });
        })
        .catch(error => console.warn('Background meeting summary failed:', error.message))
        .finally(() => {
            summaryInFlight = false;
        });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        id: `${currentSessionId}:screen:${++screenSequence}`,
        type: 'screen',
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);
    if (screenAnalysisHistory.length > 100) screenAnalysisHistory = screenAnalysisHistory.slice(-100);
    console.log('Saved screen analysis:', analysisEntry);

    appendSessionRecord(currentSessionId, analysisEntry).catch(error => sendToRenderer('update-status', `History error: ${error.message}`));
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

function buildSessionContextText() {
    return buildRelevantContext({
        query: pendingTypedQuestion || currentTranscription,
        summary: currentSummary,
        records: [...conversationHistory, ...screenAnalysisHistory].sort((a, b) => a.timestamp - b.timestamp),
    });
}

function composeUserTurn(text) {
    const context = buildSessionContextText();
    if (!context) {
        return text;
    }
    return `${context}\n\nCurrent user question (answer using the full conversation and any screen context above):\n${text}`;
}

// Gemini Live can only answer by speaking, and the transcript of that speech gives short, unformatted
// answers. In BYOK mode Live listens and transcribes, and a text model writes every answer shown:
// the model picked on the start screen, through OpenRouter, when that key is saved (answerModel.js),
// otherwise Gemini Flash.
// Answers go to one of two screens (answerLanes.js): the main screen keeps the answer being read and
// counter-questions get the second screen. Coding mode (codingSession.js) runs the DSA skill as one
// conversation per problem.
const GEMINI_ANSWER_MODEL = 'gemini-3.8-flash';
const ANSWER_MAX_OUTPUT_TOKENS = 8192;
// 3.x sends the question transcript in snapshots; wait for it to settle before answering.
const ANSWER_DEBOUNCE_MS = 400;
const ANSWER_CONTEXT_CHARS = 6000;
// Every answer stream starts above all earlier sequences, so a merged question can replace its card.
const ANSWER_SEQUENCE_STEP = 1000000;
// A repeated coding hotkey within this time is a double press, not a second request.
const CODING_COMMAND_DEBOUNCE_MS = 1500;
// Interviewer speech from this far back goes with a new coding problem, in case they read it out.
const HEARD_WINDOW_MS = 3 * 60 * 1000;
const MAX_TRACKED_CARDS = 300;
let answerClient = null;
let answerClientKey = '';
let answerTimer = null;
let answerSequenceBase = 0;
let liveInputTurnSeq = 0;
let lastVoiceQuestion = null;
// Set when a text answer fails, so Live's own spoken answer is shown for the turn instead.
let liveAnswerFallbackPending = false;
/** @typedef {{abort:AbortController, turnId:string, codingTurn:import('./codingSession').CodingTurn|null}} AnswerRequest */
// Every running answer request, so a reset or a newer question can cancel it and stop its billing.
/** @type {Set<AnswerRequest>} */
const answerRequests = new Set();
// The request streaming on each screen in normal mode; a newer answer for that screen replaces it.
/** @type {{main: AnswerRequest|null, side: AnswerRequest|null}} */
const laneRequests = { main: null, side: null };
// What each card shows, so new speech knows whether it may still rewrite it.
/** @type {Map<string, {lane:'main'|'side', text:string, firstTextAt:number, codingTurn:import('./codingSession').CodingTurn|null}>} */
const answerCards = new Map();
let hasMainCard = false;
let mainQuestion = '';
let answerSessionId = '';
let answerModel = answerModelById();
/** @type {{at:number, text:string}[]} */
let heardLog = [];
let lastCodingCommand = { name: '', at: 0 };
// Set when Jev hears that something is about to be shared ("I'm sharing a doc, open it"); the next question
// in this window gets a screenshot taken when it ends.
const SCREEN_SHARE_WINDOW_MS = 2 * 60 * 1000;
let screenShareAt = 0;
// Jev's decision for the question as heard so far, started on each new piece of speech so it is ready
// when the 400 ms pause ends. Used only if the question that gets answered has exactly this text.
/** @type {{question:string, abort:AbortController, decision:ReturnType<typeof decideScreen>}|null} */
let earlyScreenDecision = null;
// The newest ask of each turn still waiting for Jev. An ask whose question was asked again with more
// words, or whose session stopped, sends nothing.
/** @type {Map<string, number>} */
const waitingAsks = new Map();
let askSeq = 0;
// Counts "new problem" requests, so a screenshot that finishes after a newer request or an exit is dropped.
let codingProblemStart = 0;
const codingSession = new CodingSession();

function textAnswersEnabled() {
    return currentProviderMode === 'byok';
}

// Shared by text answers and screen analysis so the HTTPS connection stays warm.
function getTextModelClient(apiKey) {
    if (!answerClient || answerClientKey !== apiKey) {
        answerClient = new GoogleGenAI({ apiKey });
        answerClientKey = apiKey;
    }
    return answerClient;
}

function rememberHeard(text) {
    const now = Date.now();
    heardLog = [...heardLog.filter(item => now - item.at <= HEARD_WINDOW_MS), { at: now, text }];
}

function recentHeardText() {
    const now = Date.now();
    return heardLog
        .filter(item => now - item.at <= HEARD_WINDOW_MS)
        .map(item => item.text)
        .join(' ')
        .slice(-1500);
}

function rememberCard(turnId, card) {
    answerCards.delete(turnId);
    answerCards.set(turnId, card);
    if (answerCards.size > MAX_TRACKED_CARDS) answerCards.delete(answerCards.keys().next().value);
}

/** @param {AnswerRequest|null} request */
function cancelRequest(request) {
    if (!request) return;
    request.abort.abort();
    answerRequests.delete(request);
}

function cancelCodingRequests() {
    for (const request of [...answerRequests]) if (request.codingTurn) cancelRequest(request);
}

function notifyCodingMode() {
    sendToRenderer('coding-mode-changed', { active: codingSession.active });
}

function cancelTextAnswers() {
    for (const request of [...answerRequests]) cancelRequest(request);
    laneRequests.main = null;
    laneRequests.side = null;
    answerCards.clear();
    hasMainCard = false;
    mainQuestion = '';
    heardLog = [];
    clearTimeout(answerTimer);
    answerTimer = null;
    lastVoiceQuestion = null;
    liveAnswerFallbackPending = false;
    screenShareAt = 0;
    waitingAsks.clear();
    codingProblemStart++;
    if (codingSession.active) {
        codingSession.stop();
        notifyCodingMode();
    }
}

function scheduleAnswerForVoiceTurn() {
    const turnSeq = liveInputTurnSeq;
    const fragment = currentTranscription.trim();
    if (!textAnswersEnabled() || !fragment) return;
    clearTimeout(answerTimer);
    answerTimer = setTimeout(() => {
        answerTimer = null;
        if (lastVoiceQuestion?.turnSeq === turnSeq && lastVoiceQuestion.fragment === fragment) return;
        if (isBackchannel(fragment)) {
            // "Okay" or "mm-hmm" needs no answer and must not join the question before it. Coding mode
            // still logs it, since "yes" can confirm an assumption.
            if (codingSession.active) codingSession.addTurn({ text: `they said: ${fragment}` }).reply = 'LANE: NONE';
            return;
        }
        lastVoiceQuestion = upcomingVoiceQuestion(fragment, turnSeq, () => createTurnId('answer'));
        answerSpokenQuestion(questionText(lastVoiceQuestion), lastVoiceQuestion.turnId);
    }, ANSWER_DEBOUNCE_MS);
    // ponytail: one Jev call per piece of speech (about $0.00002 each); the superseded call is aborted.
    if (!isBackchannel(fragment)) startEarlyScreenDecision(questionText(upcomingVoiceQuestion(fragment, turnSeq, () => '')));
}

function upcomingVoiceQuestion(fragment, turnSeq, newTurnId) {
    const previous = lastVoiceQuestion;
    const now = Date.now();
    const card = previous ? answerCards.get(previous.turnId) : null;
    // Speech that continues a question may rewrite its answer only until the user starts reading it.
    const canMerge = !card || isReplaceableAnswer({ text: card.text, firstTextAt: card.firstTextAt, now });
    return nextVoiceQuestion(previous, { fragment, turnSeq, now, newTurnId, canMerge });
}

function startEarlyScreenDecision(question) {
    earlyScreenDecision?.abort.abort();
    earlyScreenDecision = null;
    if (getPreferences().autoScreenContext === false || !getOpenRouterApiKey()) return;
    const abort = new AbortController();
    earlyScreenDecision = { question, abort, decision: screenDecisionFor(question, false, abort.signal) };
}

function screenDecisionFor(question, typed, signal) {
    const threshold = SENSITIVITY[getPreferences().screenContextSensitivity] ?? SENSITIVITY.balanced;
    const recent = recentHeardText().slice(-600);
    return decideScreen({
        apiKey: getOpenRouterApiKey(),
        recent,
        latest: question,
        typed,
        threshold,
        profile: currentProfile,
        fetchImpl: net.fetch,
        signal,
    });
}

// A question asked again with more words replaces its own earlier answer and its coding turn. The
// model picks the screen again from the whole question: "Can you walk me through" alone looks like a
// follow-up, but the full question may be a new topic, and then the card moves to the main screen.
function answerSpokenQuestion(question, turnId) {
    cancelTurn(turnId);
    return askWithScreenContext({
        question,
        turnId,
        typed: false,
        send: (imageJpeg, depth) =>
            codingSession.active
                ? sendCodingTurn({ text: `they said: ${question}`, label: question, turnId, imageJpeg, depth })
                : sendNormalAnswer(question, { turnId, imageJpeg, depth }),
    });
}

/** Stops a turn's answer and drops its coding turn, so the turn can be answered again. */
function cancelTurn(turnId) {
    for (const request of [...answerRequests]) {
        if (request.turnId !== turnId) continue;
        cancelRequest(request);
        if (request.codingTurn) codingSession.removeTurn(request.codingTurn);
    }
    const earlier = answerCards.get(turnId)?.codingTurn;
    if (earlier) codingSession.removeTurn(earlier);
}

/**
 * Waits for Jev, which has usually decided while the question was still being spoken (about 100 ms left
 * when it ends; about 450 ms for a fresh call), then answers once: with a screenshot taken when the
 * question ended if the answer needs the screen, and quick or after thinking, as Jev chose. A keyword
 * such as "look at this", or something announced as being shared, attaches the screenshot whatever Jev
 * says. With Jev switched off in Settings every answer is quick; when Jev fails the model thinks.
 * @param {{question:string, turnId:string, typed:boolean, send:(imageJpeg:string|null, depth:import('./answerModel').AnswerDepth) => unknown}} options
 */
async function askWithScreenContext({ question, turnId, typed, send }) {
    const early = earlyScreenDecision;
    earlyScreenDecision = null;
    const reused = !typed && early?.question === question;
    if (early && !reused) early.abort.abort();
    const prefs = getPreferences();
    const lastShot = lastScreenshotJpeg && needsVisualContext(question) ? lastScreenshotJpeg : null;
    if (prefs.autoScreenContext === false || !getOpenRouterApiKey()) {
        console.log('[screen] jev off, quick');
        return send(lastShot, 'quick');
    }
    const seq = ++askSeq;
    waitingAsks.set(turnId, seq);
    const shot = captureScreenStill({ quality: prefs.selectedImageQuality || 'medium' }).then(result => {
        if (!result.success) {
            console.warn(`[screen] capture failed: ${result.error}`);
            return null;
        }
        rememberScreenshot(result.data);
        return result.data;
    });
    // A meeting shares screens all the time and says "can you see my screen?", so there Jev alone decides.
    const meeting = currentProfile === 'meeting';
    const sharing = !meeting && Date.now() - screenShareAt <= SCREEN_SHARE_WINDOW_MS;
    const keyword = !meeting && needsVisualContext(question);
    if (sharing) screenShareAt = 0;
    const askedAt = Date.now();
    // ponytail: waits for Jev up to its 2 s timeout; add a shorter cap if fresh calls show up often in the log.
    const decision = await (reused ? early.decision : screenDecisionFor(question, typed));
    const depth = decision?.depth ?? 'think';
    if (!decision) console.log('[screen] jev unavailable, thinking');
    else {
        const think = decision.thinkProbability === null ? '' : ` ${decision.thinkProbability.toFixed(2)}`;
        console.log(
            `[screen] jev ${decision.action} ${(decision.probabilities.now ?? 0).toFixed(2)}, ${depth}${think}, ${Date.now() - askedAt} ms after the question${reused ? ' (early)' : ''}`
        );
        if (!sharing && announcesShare(decision)) screenShareAt = Date.now();
    }
    let imageJpeg = null;
    if (sharing || keyword || decision?.action === 'now') {
        if (sharing || keyword) console.log(`[screen] ${sharing ? 'pending share' : 'keyword'}`);
        imageJpeg = await shot;
    }
    if (waitingAsks.get(turnId) !== seq) return;
    waitingAsks.delete(turnId);
    return send(imageJpeg, depth);
}

// Jev through Chromium's network stack shares one HTTP/2 connection with the answer stream and keeps it
// open longer: 0.49 s instead of 0.83 s on 2026-10-17. The first call of a session took 1.05 s instead of
// 0.48 s, so one throwaway call at session start pays that before the first question.
function warmScreenDecision() {
    const apiKey = getOpenRouterApiKey();
    if (getPreferences().autoScreenContext === false || !apiKey) return;
    decideScreen({ apiKey, latest: 'Hello', threshold: 1, fetchImpl: net.fetch, timeoutMs: 5000 });
}

async function streamGeminiAnswer({ apiKey, systemPrompt, messages, signal, onText }) {
    const stream = await getTextModelClient(apiKey).models.generateContentStream({
        model: GEMINI_ANSWER_MODEL,
        contents: toGeminiContents(messages),
        config: {
            systemInstruction: systemPrompt,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
            abortSignal: signal,
        },
    });
    let text = '';
    for await (const chunk of stream) {
        if (chunk.text) {
            text += chunk.text;
            onText(text);
        }
    }
    return { text };
}

function markMainAnswer(question) {
    hasMainCard = true;
    mainQuestion = question;
}

/**
 * A new main answer replaces the main and follow-up answers still being written; a new follow-up
 * replaces only the follow-up. Coding steps follow each other, so they replace nothing.
 * @param {AnswerRequest} request @param {'main'|'side'} lane @param {string} question
 */
function claimLane(request, lane, question) {
    if (lane === 'main') markMainAnswer(question);
    if (request.codingTurn) return;
    const replaced = lane === 'main' ? [laneRequests.main, laneRequests.side] : [laneRequests.side];
    for (const old of replaced) if (old && old !== request) cancelRequest(old);
    if (lane === 'main') laneRequests.side = null;
    laneRequests[lane] = request;
}

function shortLabel(text, limit = 70) {
    const clean = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * Streams one answer and puts it on a screen. The screen comes from the reply's LANE line unless
 * `lane` is given (hotkey commands always belong on the main screen).
 * @param {{question:string, label:string, turnId?:string, lane?:'main'|'side'|null, systemPrompt:string,
 *   messages:import('./answerModel').ChatMessage[], codingTurn?:import('./codingSession').CodingTurn|null,
 *   depth?:import('./answerModel').AnswerDepth}} options
 */
async function streamLanedAnswer({
    question,
    label,
    turnId = createTurnId('answer'),
    lane: fixedLane = null,
    systemPrompt,
    messages,
    codingTurn = null,
    depth = 'think',
}) {
    const apiKey = getApiKey();
    if (!apiKey || !question.trim()) return;
    const openRouterKey = getOpenRouterApiKey();
    /** @type {AnswerRequest} */
    const request = { abort: new AbortController(), turnId, codingTurn };
    answerRequests.add(request);
    const { signal } = request.abort;
    const sequenceBase = (answerSequenceBase += ANSWER_SEQUENCE_STEP);
    const startedAt = Date.now();
    /** @type {'main'|'side'|'none'|null} */
    let lane = null;
    let card = null;
    let changedCard = null;
    let shown = '';
    let firstTextAt = 0;

    const split = body => (codingTurn && lane === 'side' ? splitSideUpdate(body) : { answer: body, update: null });
    const show = raw => {
        if (signal.aborted) return;
        if (codingTurn) codingTurn.reply = raw;
        const header = parseLaneHeader(raw);
        if (header.status === 'pending') return;
        if (!lane) {
            lane = header.lane === 'none' ? 'none' : fixedLane || resolveLane(header.lane, { hasMainAnswer: hasMainCard });
            if (lane === 'none') {
                // Stop the request at once so a remark that needs no answer costs almost nothing.
                request.abort.abort();
                return;
            }
            claimLane(request, lane, question);
            card = createAnswerStream('answer', { turnId, sequenceBase, lane, label: shortLabel(label) });
        }
        const { answer, update } = split(header.body);
        if (answer.trim()) {
            firstTextAt ||= Date.now();
            shown = formatAnswerForDisplay(answer);
            card.update(shown);
            rememberCard(turnId, { lane, text: answer, firstTextAt, codingTurn });
        }
        if (update?.trim()) {
            changedCard ||= createAnswerStream('update', {
                sequenceBase,
                lane: 'main',
                label: `Changed after "${shortLabel(question, 50)}"`,
                focus: false,
            });
            changedCard.update(formatAnswerForDisplay(update));
        }
    };

    const gemini = ({ signal, onText }) => streamGeminiAnswer({ apiKey, systemPrompt, messages, signal, onText });
    sendToRenderer('update-status', depth === 'think' ? 'Thinking...' : 'Answering...');
    let result = null;
    let failure = null;
    try {
        result = openRouterKey
            ? await answerWithFallback({
                  primary: ({ signal, onText }) =>
                      streamOpenRouterAnswer({
                          apiKey: openRouterKey,
                          model: answerModel,
                          systemPrompt,
                          messages,
                          maxTokens: ANSWER_MAX_OUTPUT_TOKENS,
                          sessionId: answerSessionId,
                          cacheConversation: Boolean(codingTurn),
                          depth,
                          signal,
                          onText,
                      }),
                  fallback: gemini,
                  signal,
                  onText: show,
                  firstTextTimeoutMs: answerModel.firstTextMs[depth],
              })
            : { ...(await gemini({ signal, onText: show })), usedFallback: false };
    } catch (error) {
        failure = error;
    } finally {
        answerRequests.delete(request);
        if (laneRequests.main === request) laneRequests.main = null;
        if (laneRequests.side === request) laneRequests.side = null;
    }

    // A trailing newline settles a reply too short to have finished its LANE line while streaming.
    if (!failure && result?.text.trim()) show(`${result.text}\n`);
    if (lane === 'none') {
        // Nothing to answer. A coding turn keeps the remark in the conversation log.
        if (codingTurn) codingTurn.reply = 'LANE: NONE';
        console.log(`[answer] no answer needed for "${shortLabel(question, 60)}"`);
        if (!answerRequests.size) sendToRenderer('update-status', codingSession.active ? 'Coding mode' : 'Listening...');
        return;
    }
    if (signal.aborted) return;
    if (failure || !result?.text.trim()) {
        if (codingTurn) codingSession.removeTurn(codingTurn);
        else liveAnswerFallbackPending = true;
        console.error('Text answer failed:', failure?.message || 'empty answer');
        sendToRenderer('update-status', `Answer failed: ${failure?.message || 'no text'}`);
        return;
    }

    const body = parseLaneHeader(`${result.text}\n`).body.trim();
    const { answer, update } = split(body);
    if (shown) card.complete(formatAnswerForDisplay(answer.trim()));
    if (changedCard && update) changedCard.complete(formatAnswerForDisplay(update.trim()));
    if (codingTurn) codingTurn.reply = result.text;
    recordConversationTurn(question, (answer || body).trim());
    if (result.primaryError) console.warn(`OpenRouter answer failed (${result.primaryError.message}); Gemini answered instead`);
    const model = openRouterKey && !result.usedFallback ? answerModel.id : GEMINI_ANSWER_MODEL;
    const cost = result.cost ? `, $${result.cost.toFixed(4)}` : '';
    console.log(
        `[answer] ${model} ${codingTurn ? 'coding' : currentProfile || 'interview'} ${lane} ${depth}: first text ${firstTextAt - startedAt} ms, done ${Date.now() - startedAt} ms${cost}`
    );
    if (!answerRequests.size) sendToRenderer('update-status', codingSession.active ? 'Coding mode' : 'Listening...');
}

/** @param {string} question @param {{turnId?:string, imageJpeg?:string|null, depth?:import('./answerModel').AnswerDepth}} [options] */
function sendNormalAnswer(question, { turnId = createTurnId('answer'), imageJpeg = null, depth = 'think' } = {}) {
    const records = [...conversationHistory, ...screenAnalysisHistory].sort((a, b) => a.timestamp - b.timestamp);
    const context = buildRelevantContext({ query: question, summary: currentSummary, records }).slice(-ANSWER_CONTEXT_CHARS);
    const userText = `${context ? `Conversation so far:\n${context}\n\n` : ''}Main question on screen: ${mainQuestion || 'none yet'}\n\nQuestion:\n${question}`;
    return streamLanedAnswer({
        question,
        // 📷 marks every answer that was sent a screenshot of the user's screen.
        label: imageJpeg ? `📷 ${question}` : question,
        turnId,
        systemPrompt:
            currentProfile === 'meeting'
                ? `${getSystemPrompt('meeting', buildMeetingContextBlock(getPreferences()), false)}\n\n${LANE_INSTRUCTION}`
                : `${currentSystemPrompt || 'You are a helpful assistant.'}\n\n${LANE_INSTRUCTION}\n\n${CODING_ANSWER_INSTRUCTION}`,
        messages: [{ role: 'user', text: userText, imageJpeg }],
        depth,
    });
}

/** @param {{text:string, label:string, imageJpeg?:string|null, turnId?:string, lane?:'main'|'side'|null, depth?:import('./answerModel').AnswerDepth}} turn */
function sendCodingTurn({ text, label, imageJpeg = null, turnId = createTurnId('code'), lane = null, depth = 'think' }) {
    const codingTurn = codingSession.addTurn({ text, imageJpeg });
    return streamLanedAnswer({
        question: label,
        label: imageJpeg ? `📷 ${label}` : label,
        turnId,
        lane,
        systemPrompt: loadCodingSkill(currentProfile),
        messages: codingSession.messagesThrough(codingTurn),
        codingTurn,
        depth,
    });
}

async function startCodingProblem(problemText = '') {
    const start = ++codingProblemStart;
    lastVoiceQuestion = null;
    sendToRenderer('update-status', 'Reading the problem...');
    const shot = await captureScreenStill({ quality: 'medium' });
    // A second "new problem" or "exit" while the screenshot was taken wins.
    if (start !== codingProblemStart) return;
    cancelCodingRequests();
    codingSession.startProblem();
    notifyCodingMode();
    if (!shot.success) console.warn('Coding mode screenshot failed:', shot.error);
    const heard = recentHeardText();
    const text = [
        'NEW PROBLEM. Start with Part 1.',
        shot.success ? 'The screenshot shows my screen with the problem.' : `No screenshot (${shot.error}).`,
        problemText ? `The problem as I typed it: ${problemText}` : '',
        heard ? `Recently heard from the interviewer: "${heard}"` : '',
    ]
        .filter(Boolean)
        .join('\n');
    return sendCodingTurn({ text, label: 'New problem', imageJpeg: shot.success ? shot.data : null, lane: 'main' });
}

function exitCodingMode() {
    codingProblemStart++;
    if (!codingSession.active) return;
    cancelCodingRequests();
    codingSession.stop();
    lastVoiceQuestion = null;
    notifyCodingMode();
    sendToRenderer('update-status', 'Coding mode off');
}

/**
 * Runs a coding-mode hotkey or typed command.
 * @param {string} name one of new, better, code, next, full, dryrun, exit
 * @param {{problemText?:string}} [options]
 */
function handleCodingCommand(name, { problemText = '' } = {}) {
    if (!textAnswersEnabled() || !sessionParams) return { success: false, error: 'Coding mode needs a running "Use your API keys" session' };
    if (!getApiKey()) return { success: false, error: 'No Gemini API key configured' };
    const now = Date.now();
    if (lastCodingCommand.name === name && now - lastCodingCommand.at < CODING_COMMAND_DEBOUNCE_MS) return { success: true, ignored: true };
    lastCodingCommand = { name, at: now };
    if (name === 'new') {
        startCodingProblem(problemText).catch(error => sendToRenderer('update-status', `Coding mode error: ${error.message}`));
        return { success: true };
    }
    if (name === 'exit') {
        exitCodingMode();
        return { success: true };
    }
    const command = CODING_COMMANDS[name];
    if (!command) return { success: false, error: `Unknown coding command: ${name}` };
    if (!codingSession.active) return { success: false, error: 'Coding mode is off. Start with "New problem".' };
    lastVoiceQuestion = null;
    sendCodingTurn({ text: command.text, label: command.label, lane: 'main' });
    return { success: true };
}

function rememberScreenshot(base64Data) {
    if (base64Data && typeof base64Data === 'string' && base64Data.length > 100) {
        lastScreenshotJpeg = base64Data;
    }
}

async function getEnabledTools() {
    const tools = [
        {
            functionDeclarations: [
                {
                    name: 'search_meeting',
                    behavior: 'BLOCKING',
                    description: 'Search earlier meeting transcripts and screen analyses for facts relevant to a question.',
                    parameters: {
                        type: 'OBJECT',
                        properties: { query: { type: 'STRING', description: 'The fact or topic to find.' } },
                        required: ['query'],
                    },
                },
            ],
        },
    ];
    const googleSearchEnabled = getPreferences().googleSearchEnabled === true;
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled) {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function answerMeetingSearchTools(message, session, connectionGeneration) {
    const calls = message.toolCall?.functionCalls || [];
    for (const call of calls) {
        if (call.name !== 'search_meeting' || !liveConnections.isCurrent(connectionGeneration)) continue;
        let records = [...conversationHistory, ...screenAnalysisHistory];
        try {
            const archived = currentSessionId ? await getArchivedSession(currentSessionId) : null;
            if (archived) records = [...(archived.conversationHistory || []), ...(archived.screenAnalysisHistory || [])];
        } catch (error) {
            console.warn('Meeting search used in-memory history:', error.message);
        }
        const output = buildRelevantContext({ query: call.args?.query || '', summary: currentSummary, records });
        if (!liveConnections.isCurrent(connectionGeneration)) return;
        session.sendToolResponse({
            functionResponses: [{ id: call.id, name: call.name, response: { output: output || 'No matching meeting context found.' } }],
        });
    }
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != '';
}

function canUseGroqFallback() {
    return currentProviderMode === 'byok' && hasGroqKey() && !sessionParams;
}

const VISUAL_TRIGGER_KEYWORDS = [
    'look at',
    'looking at',
    'this code',
    'this problem',
    'this question',
    'solve this',
    'debug this',
    'this error',
    'this output',
    'this function',
    'this class',
    'this method',
    'this algorithm',
    'this diagram',
    'this slide',
    'this screen',
    'what do you see',
    'what is this',
    'what does this',
    'explain this',
    'analyze this',
    'help me with this',
    'read this',
    "what's on",
    'on the screen',
    'on screen',
    'your screen',
    'the screen',
    'can you see',
    'do you see',
    'visible on',
    'shown here',
    'in the image',
    'on my screen',
    'from the screen',
];

function needsVisualContext(transcription) {
    const lower = transcription.toLowerCase();
    return VISUAL_TRIGGER_KEYWORDS.some(kw => lower.includes(kw));
}

function trimConversationHistoryForGemma(history, maxChars = 42000) {
    if (!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if (totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function sendToGroq(transcription) {
    const answer = createAnswerStream('groq');
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        console.log('No Groq API key configured, skipping Groq response');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Groq');
        return;
    }

    const modelToUse = getModelForToday();
    if (!modelToUse) {
        console.log('All Groq daily limits exhausted');
        sendToRenderer('update-status', 'Groq limits reached for today');
        return;
    }

    console.log(`Sending to Groq (${modelToUse}):`, transcription.substring(0, 100) + '...');

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    if (groqConversationHistory.length > 20) {
        groqConversationHistory = groqConversationHistory.slice(-20);
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...groqConversationHistory],
                stream: true,
                temperature: 0.7,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', response.status, errorText);
            sendToRenderer('update-status', `Groq error: ${response.status}`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        const token = json.choices?.[0]?.delta?.content || '';
                        if (token) {
                            fullText += token;
                            const displayText = stripThinkingTags(fullText);
                            if (displayText) {
                                answer.update(displayText);
                                isFirst = false;
                            }
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        const cleanedResponse = stripThinkingTags(fullText);
        const modelKey = modelToUse.split('/').pop();

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = groqConversationHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = cleanedResponse.length;

        incrementCharUsage('groq', modelKey, inputChars + outputChars);

        if (cleanedResponse) {
            answer.complete(cleanedResponse);
            groqConversationHistory.push({
                role: 'assistant',
                content: cleanedResponse,
            });

            saveConversationTurn(transcription, cleanedResponse);
        }

        console.log(`Groq response completed (${modelToUse})`);
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Groq API:', error);
        sendToRenderer('update-status', 'Groq error: ' + error.message);
    }
}

async function sendToGemma(transcription) {
    const answer = createAnswerStream('gemma');
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('No Gemini API key configured');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Gemma');
        return;
    }

    console.log('Sending to Gemma:', transcription.substring(0, 100) + '...');

    groqConversationHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    const trimmedHistory = trimConversationHistoryForGemma(groqConversationHistory, 42000);

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const messages = trimmedHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        const systemPrompt = currentSystemPrompt || 'You are a helpful assistant.';
        const messagesWithSystem = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ...messages,
        ];

        const response = await ai.models.generateContentStream({
            model: 'gemma-3-27b-it',
            contents: messagesWithSystem,
        });

        let fullText = '';
        let isFirst = true;

        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                answer.update(fullText);
                isFirst = false;
            }
        }

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = trimmedHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = fullText.length;

        incrementCharUsage('gemini', 'gemma-3-27b-it', inputChars + outputChars);

        if (fullText.trim()) {
            answer.complete(fullText.trim());
            groqConversationHistory.push({
                role: 'assistant',
                content: fullText.trim(),
            });

            if (groqConversationHistory.length > 40) {
                groqConversationHistory = groqConversationHistory.slice(-40);
            }

            saveConversationTurn(transcription, fullText);
        }

        console.log('Gemma response completed');
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Gemma API:', error);
        sendToRenderer('update-status', 'Gemma error: ' + error.message);
    }
}

function dispatchTranscription() {
    if (currentTranscription.trim() === '') return;
    const text = currentTranscription;
    currentTranscription = '';
    console.log('[silence-dispatch] Firing Groq/Gemma after silence timeout');
    if (hasGroqKey()) {
        sendToGroq(text);
    } else {
        sendToGemma(text);
    }
}

function resetTranscriptionSilenceTimer() {
    clearTranscriptionSilenceTimer();
    transcriptionSilenceTimer = setTimeout(dispatchTranscription, clientSilenceTimeoutMs());
}

function clearTranscriptionSilenceTimer() {
    if (transcriptionSilenceTimer) {
        clearTimeout(transcriptionSilenceTimer);
        transcriptionSilenceTimer = null;
    }
}

function clearLateTranscriptionTimer() {
    if (lateTranscriptionTimer) {
        clearTimeout(lateTranscriptionTimer);
        lateTranscriptionTimer = null;
    }
}

function waitForLateLiveTurn() {
    awaitingLateTranscript = true;
    clearLateTranscriptionTimer();
    lateTranscriptionTimer = setTimeout(() => {
        lateTranscriptionTimer = null;
        finalizeLiveConversationTurn();
    }, LATE_TRANSCRIPT_MS);
}

// True when this event belongs to a turn the watchdog already finished and nothing new has streamed since.
function consumeStalledTurnEvent() {
    if (!stalledTurnPending) return false;
    stalledTurnPending = false;
    return !liveOutputText.trim();
}

function handleLiveTurnComplete() {
    if (consumeStalledTurnEvent()) return;
    clearTranscriptionSilenceTimer();
    if (liveOutputText.trim()) {
        finalizeLiveConversationTurn();
    } else {
        waitForLateLiveTurn();
    }
    sendToRenderer('update-status', 'Listening...');
}

function handleLiveInterrupted() {
    if (consumeStalledTurnEvent()) return;
    clearTranscriptionSilenceTimer();
    clearLateTranscriptionTimer();
    awaitingLateTranscript = false;
    const input = currentTranscription.trim();
    const output = formatLiveAnswerText(liveOutputText);
    if (output && (!textAnswersEnabled() || liveAnswerFallbackPending)) {
        if (!liveTurnId) liveTurnId = createTurnId('live');
        emitAnswer(sendToRenderer, liveTurnId, 'interrupted', output, liveOutputSequence++);
        saveConversationTurn(input || '(interrupted audio)', output);
        liveAnswerFallbackPending = false;
    }
    resetLiveConversationBuffers();
    sendToRenderer('update-status', 'Listening...');
}

function resampleLive24kTo16k(inputBuffer) {
    const combined = Buffer.concat([liveResampleRemainder, inputBuffer]);
    const inputSamples = Math.floor(combined.length / 2);
    const outputSamples = Math.floor((inputSamples * 2) / 3);
    if (outputSamples <= 0) {
        liveResampleRemainder = combined;
        return Buffer.alloc(0);
    }
    const outputBuffer = Buffer.alloc(outputSamples * 2);
    for (let i = 0; i < outputSamples; i++) {
        const srcPos = (i * 3) / 2;
        const srcIndex = Math.floor(srcPos);
        const frac = srcPos - srcIndex;
        const s0 = combined.readInt16LE(srcIndex * 2);
        const s1 = srcIndex + 1 < inputSamples ? combined.readInt16LE((srcIndex + 1) * 2) : s0;
        const interpolated = Math.round(s0 + frac * (s1 - s0));
        outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }
    const consumedInputSamples = Math.ceil((outputSamples * 3) / 2);
    const remainderStart = consumedInputSamples * 2;
    liveResampleRemainder = remainderStart < combined.length ? combined.slice(remainderStart) : Buffer.alloc(0);
    return outputBuffer;
}

function enqueueLivePcm(monoPcm, sampleRate, sessionRef, isSynthetic = false) {
    if (!isSynthetic) liveGapFiller.noteRealFrame();
    const session = sessionRef?.current;
    if (!session || !monoPcm?.length) return;
    const pcm16k = sampleRate === 16000 ? monoPcm : resampleLive24kTo16k(monoPcm);
    if (!pcm16k.length) return;
    geminiAudioQueue.push({ sequence: geminiAudioSequence++, capturedAt: Date.now(), pcm: pcm16k });
    drainGeminiQueue(sessionRef);
}

function sendImageToGeminiLive(session, data, prompt) {
    if (!session) {
        return { success: false, error: 'No active Gemini Live session' };
    }
    pendingLiveImage = { data, prompt: prompt || '' };
    const result = flushPendingLiveImage(session);
    if (result && result.success === false) {
        return result;
    }
    return { success: true, model: GEMINI_LIVE_MODEL };
}

function flushPendingLiveImage(session) {
    if (liveImageSendInFlight || !pendingLiveImage || !session) return;
    liveImageSendInFlight = true;
    const { data, prompt } = pendingLiveImage;
    pendingLiveImage = null;
    try {
        return sendForcedLiveScreenTurn(session, data, prompt);
    } catch (error) {
        console.error('Failed to send screenshot to Gemini Live:', error);
        return { success: false, error: error.message };
    } finally {
        liveImageSendInFlight = false;
        if (pendingLiveImage) {
            flushPendingLiveImage(session);
        }
    }
}

function createWavBuffer(pcmBuffer, sampleRate = 24000) {
    const numChannels = 1,
        bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(pcmBuffer.length + 36, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
}

async function transcribeWithGroqWhisper(pcmBuffer, sampleRate = 16000) {
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) return '';
    try {
        const wavBuffer = createWavBuffer(pcmBuffer, sampleRate);
        const formData = new FormData();
        formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'text');
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${groqApiKey}` },
            body: formData,
        });
        if (!response.ok) {
            console.error('Groq Whisper error:', response.status, await response.text());
            return '';
        }
        const text = (await response.text()).trim();
        console.log('[whisper] Transcribed:', text.substring(0, 80));
        return text;
    } catch (err) {
        console.error('Groq Whisper exception:', err);
        return '';
    }
}

function resetWhisperVadState() {
    whisperIsSpeaking = false;
    whisperSpeechFrames = 0;
    whisperSilenceFrames = 0;
    whisperAudioBuffer = [];
    whisperPreBuffer = [];
    whisperAudioBytes = 0;
    whisperJobs = [];
    whisperJobGeneration++;
    previousWhisperTranscript = '';
}

function queueWhisperJob(pcm) {
    if (whisperJobs.length >= 2) whisperJobs.shift();
    whisperJobs.push({ pcm, generation: whisperJobGeneration });
    drainWhisperJobs();
}

async function drainWhisperJobs() {
    if (whisperJobActive) return;
    whisperJobActive = true;
    while (whisperJobs.length) {
        const job = whisperJobs.shift();
        if (job.generation !== whisperJobGeneration) continue;
        const raw = await transcribeWithGroqWhisper(job.pcm, 16000);
        const { removeTranscriptOverlap } = require('./transcriptOverlap');
        const transcription = removeTranscriptOverlap(previousWhisperTranscript, raw);
        previousWhisperTranscript = raw || previousWhisperTranscript;
        if (!transcription.trim()) continue;
        if (needsVisualContext(transcription)) sendToRenderer('auto-capture-screenshot', { transcription });
        else sendToGroq(transcription);
    }
    whisperJobActive = false;
    sendToRenderer('update-status', 'Listening...');
}

async function processAudioForWhisper(monoChunk, sampleRate = 24000) {
    if (sampleRate !== 16000) monoChunk = resampleLive24kTo16k(monoChunk);
    // Calculate RMS energy of this chunk
    let sum = 0;
    for (let i = 0; i < monoChunk.length - 1; i += 2) {
        const s = monoChunk.readInt16LE(i) / 32768.0;
        sum += s * s;
    }
    const rms = Math.sqrt(sum / (monoChunk.length / 2));
    const isSpeech = rms > WHISPER_SILENCE_THRESHOLD;

    // Maintain pre-speech rolling buffer
    whisperPreBuffer.push(monoChunk);
    if (whisperPreBuffer.length > WHISPER_PRE_BUFFER_FRAMES) {
        whisperPreBuffer.shift();
    }

    if (isSpeech) {
        whisperSpeechFrames++;
        whisperSilenceFrames = 0;
        if (!whisperIsSpeaking && whisperSpeechFrames >= WHISPER_SPEECH_START_FRAMES) {
            whisperIsSpeaking = true;
            // Include pre-buffer frames so we don't cut off utterance start
            whisperAudioBuffer = [...whisperPreBuffer];
            whisperAudioBytes = whisperAudioBuffer.reduce((sum, frame) => sum + frame.length, 0);
            sendToRenderer('update-status', 'Transcribing...');
        }
    } else {
        whisperSilenceFrames++;
        whisperSpeechFrames = 0;
    }

    if (whisperIsSpeaking) {
        if (isSpeech) {
            whisperAudioBuffer.push(monoChunk);
            whisperAudioBytes += monoChunk.length;
            if (whisperAudioBytes >= MAX_WHISPER_SEGMENT_BYTES) {
                const combined = Buffer.concat(whisperAudioBuffer);
                queueWhisperJob(combined.subarray(0, MAX_WHISPER_SEGMENT_BYTES));
                const overlap = combined.subarray(Math.max(0, MAX_WHISPER_SEGMENT_BYTES - WHISPER_OVERLAP_BYTES));
                whisperAudioBuffer = [Buffer.from(overlap)];
                whisperAudioBytes = overlap.length;
            }
        }

        if (!isSpeech && whisperSilenceFrames >= WHISPER_SILENCE_END_FRAMES) {
            // End of utterance — send to Whisper
            whisperIsSpeaking = false;
            const utterancePcm = Buffer.concat(whisperAudioBuffer);
            whisperAudioBuffer = [];
            whisperAudioBytes = 0;
            whisperSpeechFrames = 0;
            whisperSilenceFrames = 0;

            queueWhisperJob(utterancePcm);
        }
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    isUserClosing = false;
    const connectionGeneration = liveConnections.begin();
    let liveSession = null;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
        sessionResumptionHandle = null;
        liveResampleRemainder = Buffer.alloc(0);
        pendingLiveImage = null;
    }

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    // Live only transcribes and re-bills its prompt every turn, so the meeting context goes to the answer model only.
    const systemPrompt = getSystemPrompt(profile, profile === 'meeting' ? '' : customPrompt, googleSearchEnabled);
    currentSystemPrompt = systemPrompt; // Store for Groq

    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    }

    try {
        console.log(`Connecting Gemini Live: ${GEMINI_LIVE_MODEL}`);
        liveSession = await connectGeminiLive({
            apiKey,
            model: GEMINI_LIVE_MODEL,
            callbacks: {
                onopen: function () {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
                        sessionResumptionHandle = message.sessionResumptionUpdate.newHandle;
                    }
                    if (message.sessionResumptionUpdate && message.sessionResumptionUpdate.resumable === false && sessionResumptionHandle) {
                        console.warn('Gemini rejected session resumption; reconnecting once with bounded saved context');
                        sessionResumptionHandle = null;
                        liveSession?.close();
                        return;
                    }

                    answerMeetingSearchTools(message, liveSession, connectionGeneration).catch(error =>
                        console.warn('Meeting search tool failed:', error.message)
                    );

                    if (message.goAway && !isUserClosing) {
                        console.log('Live GoAway received, reconnecting with resumption handle');
                        reconnectAttempts = 0;
                        attemptReconnect({ immediate: true }).then(success => {
                            if (success) liveSession?.close();
                        });
                        return;
                    }

                    if (isLiveServerInterrupt(message)) {
                        handleLiveInterrupted();
                        return;
                    }

                    if (ingestLiveInputTranscription(message)) scheduleAnswerForVoiceTurn();
                    ingestLiveOutputTranscription(message);

                    if (message.serverContent?.turnComplete) {
                        handleLiveTurnComplete();
                    }
                },
                onerror: function (e) {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    console.log('Session error:', e.message);
                    sendToRenderer('update-status', 'Error: ' + e.message);
                },
                onclose: function (e) {
                    if (!liveConnections.isCurrent(connectionGeneration)) return;
                    console.log('Session closed:', e.reason);

                    if (isFatalConnectionClose(e)) {
                        sessionParams = null;
                        sendToRenderer('update-status', `Gemini configuration error: ${e.reason || 'authentication failed'}`);
                        return;
                    }

                    // Don't reconnect if user intentionally closed
                    if (isUserClosing) {
                        isUserClosing = false;
                        sendToRenderer('update-status', 'Session closed');
                        return;
                    }

                    // Attempt reconnection
                    if (sessionParams) {
                        attemptReconnect();
                    } else {
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            },
            config: buildGeminiLiveSessionConfig({
                language,
                vadPreset: getPreferences().vadPreset,
                tools: enabledTools,
                systemPrompt,
                sessionResumptionHandle,
            }),
        });

        if (!liveConnections.isCurrent(connectionGeneration)) {
            liveSession.close();
            isInitializingSession = false;
            return null;
        }
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return liveSession;
    } catch (error) {
        console.error('Failed to initialize Gemini session:', error);
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return null;
    }
}

async function attemptReconnect(options = {}) {
    if (isUserClosing || !sessionParams) return false;
    if (reconnectInFlight) return false;
    reconnectInFlight = true;
    if (!reconnectStartedAt) reconnectStartedAt = Date.now();

    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}`);

    resetLiveConversationBuffers();
    resetWhisperVadState();
    liveResampleRemainder = Buffer.alloc(0);

    sendToRenderer('update-status', `Reconnecting... (attempt ${reconnectAttempts})`);

    if (!options.immediate) {
        await new Promise(resolve => setTimeout(resolve, liveConnections.retryDelay(reconnectAttempts - 1)));
        if (isUserClosing || !sessionParams) {
            reconnectInFlight = false;
            return false;
        }
    }

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            if (!sessionResumptionHandle) {
                const contextMessage = buildContextMessage();
                if (contextMessage) {
                    try {
                        console.log('Restoring conversation context...');
                        session.sendRealtimeInput({ text: contextMessage });
                    } catch (contextError) {
                        console.error('Failed to restore context:', contextError);
                    }
                }
            }

            reconnectAttempts = 0;
            reconnectStartedAt = 0;
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            reconnectInFlight = false;
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    reconnectInFlight = false;

    // If we still have attempts left, try again
    if (Date.now() - reconnectStartedAt < MAX_RECONNECT_MS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Could not reconnect for 60 seconds. Check the network or restart the meeting.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-x', 'NotetakerAudio'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'NotetakerAudio');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'NotetakerAudio');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);
    liveGapFiller.start();

    const CHUNK_DURATION = 0.04;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(monoChunk);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
            } else if (geminiSessionRef.current) {
                enqueueLivePcm(monoChunk, 24000, geminiSessionRef);
            } else if (canUseGroqFallback()) {
                processAudioForWhisper(monoChunk);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        const rightSample = stereoBuffer.readInt16LE(i * 4 + 2);
        const mono = Math.round((leftSample + rightSample) / 2);
        monoBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, mono)), i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
    liveGapFiller.stop();
    geminiAudioQueue.clear();
    geminiAudioSequence = 0;
    geminiSendLock = false;
    congestionStartedAt = 0;
    if (congestionRetryTimer) clearTimeout(congestionRetryTimer);
    congestionRetryTimer = null;
    resetWhisperVadState();
}

async function drainGeminiQueue(geminiSessionRef) {
    if (geminiSendLock) return;
    geminiSendLock = true;
    while (geminiAudioQueue.length > 0) {
        const session = geminiSessionRef.current;
        if (!session) break;
        if ((session.bufferedBytes || 0) > 64000) {
            if (!congestionStartedAt) congestionStartedAt = Date.now();
            geminiSendLock = false;
            if (Date.now() - congestionStartedAt > 2000) {
                console.warn('Gemini Live congestion exceeded the audio budget; reconnecting');
                session.close();
                congestionStartedAt = 0;
                return;
            }
            if (!congestionRetryTimer) {
                congestionRetryTimer = setTimeout(() => {
                    congestionRetryTimer = null;
                    drainGeminiQueue(geminiSessionRef);
                }, 40);
            }
            return;
        }
        congestionStartedAt = 0;
        const frame = geminiAudioQueue.shift();
        await sendAudioToGemini(frame.pcm.toString('base64'), geminiSessionRef);
    }
    geminiSendLock = false;
    if (geminiSessionRef.current && pendingLiveImage) {
        flushPendingLiveImage(geminiSessionRef.current);
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=16000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGroqLlama4(base64Data, prompt) {
    const answer = createAnswerStream('screen-groq', { label: 'Analyze Screen' });
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        return { success: false, error: 'No Groq API key configured' };
    }

    const model = 'meta-llama/llama-4-scout-17b-16e-instruct';

    try {
        console.log(`Sending image to ${model} (streaming)...`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/jpeg;base64,${base64Data}` },
                            },
                            { type: 'text', text: prompt },
                        ],
                    },
                ],
                stream: true,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`Groq vision API error ${response.status}:`, errText);
            return { success: false, error: `Groq vision error: ${response.status}` };
        }

        let fullText = '';
        let isFirst = true;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') break;
                try {
                    const chunk = JSON.parse(jsonStr);
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        answer.update(fullText);
                        isFirst = false;
                    }
                } catch (_) {}
            }
        }

        console.log(`Image response completed from ${model}`);

        if (fullText.trim()) {
            answer.complete(fullText.trim());
            groqConversationHistory.push({
                role: 'user',
                content: `[Screen context]: ${fullText.trim()}`,
            });
            if (groqConversationHistory.length > 20) {
                groqConversationHistory = groqConversationHistory.slice(-20);
            }
        }

        saveScreenAnalysis(prompt, fullText, model);
        return { success: true, text: fullText, model: model };
    } catch (error) {
        console.error('Error sending image to Groq Llama4:', error);
        return { success: false, error: error.message };
    }
}

async function sendImageToGeminiHttp(base64Data, request) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    const answer = createAnswerStream('screen-gemini', { label: 'Analyze Screen' });
    const records = [...conversationHistory, ...screenAnalysisHistory].sort((a, b) => a.timestamp - b.timestamp);
    const context = buildRelevantContext({ query: request, summary: currentSummary, records });
    const screenRequest = buildScreenAnalysisRequest({ data: base64Data, request, context });
    const userText = screenRequest.contents[0].parts.find(part => part.text)?.text || '';
    const messages = [{ role: 'user', text: userText, imageJpeg: base64Data }];
    const systemPrompt = screenRequest.config.systemInstruction;
    const openRouterKey = getOpenRouterApiKey();
    const abort = new AbortController();

    let fullText = '';
    const show = text => {
        if (!fullText) markMainAnswer('Analyze Screen: the screenshot of my screen');
        fullText = text;
        answer.update(text);
    };
    const gemini = ({ signal, onText }) => streamGeminiAnswer({ apiKey, systemPrompt, messages, signal, onText });

    try {
        const asked = openRouterKey ? answerModel.id : GEMINI_ANSWER_MODEL;
        console.log(`Sending image to ${asked} (streaming)...`);
        const result = openRouterKey
            ? await answerWithFallback({
                  primary: ({ signal, onText }) =>
                      streamOpenRouterAnswer({
                          apiKey: openRouterKey,
                          model: answerModel,
                          systemPrompt,
                          messages,
                          maxTokens: ANSWER_MAX_OUTPUT_TOKENS,
                          signal,
                          onText,
                      }),
                  fallback: gemini,
                  signal: abort.signal,
                  onText: show,
                  firstTextTimeoutMs: answerModel.firstTextMs.think,
              })
            : { ...(await gemini({ signal: abort.signal, onText: show })), usedFallback: false };

        const text = String(result.text || fullText).trim();
        if (!text) {
            return { success: false, error: 'Screen analysis returned no text' };
        }
        answer.complete(text);

        // Inject screen analysis into Groq context for follow-up voice questions
        groqConversationHistory.push({
            role: 'user',
            content: `[Screen context]: ${text}`,
        });
        if (groqConversationHistory.length > 20) {
            groqConversationHistory = groqConversationHistory.slice(-20);
        }

        if (result.primaryError) console.warn(`OpenRouter screen analysis failed (${result.primaryError.message}); Gemini answered instead`);
        const model = openRouterKey && !result.usedFallback ? answerModel.id : GEMINI_ANSWER_MODEL;
        console.log(`Image response completed from ${model}`);
        saveScreenAnalysis(request || 'Analyze Screen', text, model);

        return { success: true, text, model };
    } catch (error) {
        console.error('Error sending image for screen analysis:', error);
        return { success: false, error: error.message };
    }
}

function routeAudioFrame(pcmBuffer, sampleRate, geminiSessionRef) {
    if (currentProviderMode === 'cloud') {
        return { success: sendCloudAudio(pcmBuffer), provider: 'cloud' };
    }
    if (currentProviderMode === 'local') {
        getLocalAi().processLocalAudio(pcmBuffer, sampleRate);
        return { success: true, provider: 'local' };
    }
    if (geminiSessionRef.current) {
        enqueueLivePcm(pcmBuffer, sampleRate, geminiSessionRef);
        return { success: true, provider: 'gemini' };
    }
    if (canUseGroqFallback()) {
        processAudioForWhisper(pcmBuffer, sampleRate);
        return { success: true, provider: 'groq' };
    }
    return { success: false, error: 'No active AI session' };
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    // Opens the round's prompt in the default editor; edits apply from the next coding reply.
    ipcMain.handle('open-round-prompt', async (event, profile) => {
        try {
            const filePath = ensureUserSkillFile(profile);
            const error = await shell.openPath(filePath);
            return error ? { success: false, error, path: filePath } : { success: true, path: filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('initialize-cloud', async (event, token, profile, userContext) => {
        try {
            currentProviderMode = 'cloud';
            initializeNewSession(profile);
            setOnTurnComplete((transcription, response) => {
                saveConversationTurn(transcription, response);
            });
            sendToRenderer('session-initializing', true);
            await connectCloud(token, profile, userContext);
            sendToRenderer('session-initializing', false);
            return true;
        } catch (err) {
            console.error('[Cloud] Init error:', err);
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        currentProviderMode = 'byok';
        warmScreenDecision();

        // Gemini Live 3.8 conversational path (STT + overlay answer in one session)
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('initialize-local', async (event, ollamaHost, ollamaModel, whisperModel, profile, customPrompt) => {
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    ipcMain.handle('send-audio-frame', async (event, payload) => {
        try {
            const frame = validateAudioFrame(payload);
            const result = routeAudioFrame(frame.pcm, frame.sampleRate, geminiSessionRef);
            return { ...result, queuedMs: geminiAudioQueue.durationMs };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (geminiSessionRef.current) {
            enqueueLivePcm(Buffer.from(data, 'base64'), 24000, geminiSessionRef);
            return { success: true };
        }
        if (canUseGroqFallback()) {
            const pcmBuffer = Buffer.from(data, 'base64');
            processAudioForWhisper(pcmBuffer);
            return { success: true };
        }
        return { success: false, error: 'No active Gemini session' };
    });

    // Handle microphone audio on a separate channel
    ipcMain.handle('send-mic-audio-content', async (event, { data, mimeType }) => {
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (geminiSessionRef.current) {
            enqueueLivePcm(Buffer.from(data, 'base64'), 24000, geminiSessionRef);
            return { success: true };
        }
        if (canUseGroqFallback()) {
            const pcmBuffer = Buffer.from(data, 'base64');
            processAudioForWhisper(pcmBuffer);
            return { success: true };
        }
        return { success: false, error: 'No active Gemini session' };
    });

    ipcMain.handle('capture-screen-still', async (event, payload = {}) => {
        const quality = payload && typeof payload.quality === 'string' ? payload.quality : 'medium';
        const allowed = quality === 'high' || quality === 'medium' || quality === 'low' ? quality : 'medium';
        return captureScreenStill({ quality: allowed });
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            rememberScreenshot(data);
            if (codingSession.active && textAnswersEnabled()) {
                // The screenshot joins the problem's conversation: it can show my code, a failing test or a changed problem.
                lastVoiceQuestion = null;
                sendCodingTurn({ text: 'screen: This is my screen right now.', label: 'Analyze Screen', imageJpeg: data });
                return { success: true, model: 'coding' };
            }
            sendToRenderer('update-status', 'Analyzing screen...');
            // Paths whose answer is saved through saveConversationTurn label it "Analyze Screen";
            // the HTTP path saves its own screen record, so it must not leave this for the next voice turn.
            const liveScreenPrompt = () => {
                pendingTypedQuestion = 'Analyze Screen';
                return composeUserTurn(prompt || 'Analyze this screenshot now. Give the complete answer from what you see.');
            };

            const analyzePath = chooseAnalyzeScreenPath({
                providerMode: currentProviderMode,
                hasApiKey: Boolean(getApiKey()),
                hasLiveSession: Boolean(geminiSessionRef.current),
                hasGroq: canUseGroqFallback(),
            });

            if (analyzePath === 'cloud') {
                const sentImage = sendCloudImage(data);
                const sentText = sendCloudText(liveScreenPrompt());
                if (!sentImage || !sentText) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true, model: 'cloud' };
            }

            if (analyzePath === 'local') {
                return await getLocalAi().sendLocalImage(data, liveScreenPrompt());
            }

            if (analyzePath === 'http') {
                const result = await sendImageToGeminiHttp(data, prompt);
                const session = geminiSessionRef.current;
                if (result.success && result.text?.trim()) {
                    // Send once: Live gets the screen as context for voice follow-ups but is not asked to answer it.
                    if (session && typeof session.sendClientContent === 'function') {
                        try {
                            session.sendClientContent(buildLiveScreenContextContent(data, result.text));
                        } catch (error) {
                            console.warn('Could not share screen context with Live:', error.message);
                        }
                    }
                    return result;
                }
                if (session) {
                    const liveResult = sendImageToGeminiLive(session, data, liveScreenPrompt());
                    if (liveResult.success) {
                        return liveResult;
                    }
                    pendingTypedQuestion = null;
                }
                return result.success === false ? result : { success: false, error: 'Screen analysis returned no text' };
            }

            if (analyzePath === 'live') {
                return sendImageToGeminiLive(geminiSessionRef.current, data, liveScreenPrompt());
            }

            if (analyzePath === 'groq') {
                return await sendImageToGroqLlama4(
                    data,
                    composeUserTurn(prompt || 'Analyze this screenshot now. Give the complete answer from what you see.')
                );
            }

            return { success: false, error: 'No active Gemini session' };
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        const userText = text.trim();

        if (currentProviderMode === 'cloud') {
            try {
                pendingTypedQuestion = userText;
                const contextualText = composeUserTurn(userText);
                console.log('Sending text to cloud with full session context');
                if (lastScreenshotJpeg) {
                    sendCloudImage(lastScreenshotJpeg);
                }
                const sent = sendCloudText(contextualText);
                if (!sent) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud text:', error);
                return { success: false, error: error.message };
            }
        }

        if (currentProviderMode === 'local') {
            try {
                pendingTypedQuestion = userText;
                const contextualText = composeUserTurn(userText);
                console.log('Sending text to local Ollama with session context');
                if (lastScreenshotJpeg) {
                    return await getLocalAi().sendLocalImage(lastScreenshotJpeg, contextualText);
                }
                return await getLocalAi().sendLocalText(contextualText);
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        if (!getApiKey()) return { success: false, error: 'No Gemini API key configured' };
        // A typed question is a new topic, so later speech must not merge into an earlier spoken question.
        lastVoiceQuestion = null;
        const newProblem = userText.match(NEW_PROBLEM_WORDS);
        if (newProblem) return handleCodingCommand('new', { problemText: userText.slice(newProblem[0].length).trim() });
        if (codingSession.active && EXIT_WORDS.test(userText)) {
            exitCodingMode();
            return { success: true };
        }
        const turnId = createTurnId(codingSession.active ? 'code' : 'answer');
        askWithScreenContext({
            question: userText,
            turnId,
            typed: true,
            send: (imageJpeg, depth) =>
                codingSession.active
                    ? sendCodingTurn({ text: `command: ${userText}`, label: userText, turnId, imageJpeg, depth })
                    : sendNormalAnswer(userText, { turnId, imageJpeg, depth }),
        });
        return { success: true };
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async event => {
        try {
            stopMacOSAudioCapture();
            if (liveOutputText.trim() && (!textAnswersEnabled() || liveAnswerFallbackPending)) {
                if (!liveTurnId) liveTurnId = createTurnId('live');
                emitAnswer(sendToRenderer, liveTurnId, 'interrupted', formatLiveAnswerText(liveOutputText), liveOutputSequence++);
                saveConversationTurn(currentTranscription.trim() || '(interrupted audio)', formatLiveAnswerText(liveOutputText));
            }
            if (currentSessionId) await flushSessionArchive(currentSessionId);
            liveTurnWatchdog.stop();
            cancelTextAnswers();
            resetLiveConversationBuffers();

            if (currentProviderMode === 'cloud') {
                closeCloud();
                currentProviderMode = 'byok';
                return { success: true };
            }

            if (currentProviderMode === 'local') {
                getLocalAi().closeLocalSession();
                currentProviderMode = 'byok';
                return { success: true };
            }

            isUserClosing = true;
            liveConnections.stop();
            sessionParams = null;
            reconnectStartedAt = 0;
            reconnectInFlight = false;
            sessionResumptionHandle = null;
            pendingLiveImage = null;
            clearTranscriptionSilenceTimer();
            clearLateTranscriptionTimer();
            resetWhisperVadState();

            // Cleanup session
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            if (sessionParams && global.geminiSessionRef?.current) {
                sessionResumptionHandle = null;
                global.geminiSessionRef.current.close();
            }
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    handleCodingCommand,
    formatSpeakerResults,
};
