// In BYOK mode Gemini Live only listens. When an OpenRouter key is saved, the model picked on the start
// screen writes the answers through OpenRouter; otherwise, or when that request fails before any text
// arrives, Gemini Flash answers.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// The start screen lists these. Each provider keeps its own prompt cache, so a model goes to its maker's
// servers first, and the other providers OpenRouter has for it serve only as fallbacks.
// Jev picks a depth per question (screenDecision.js): 'quick' for small talk and follow-ups, 'think' for a
// new problem, code, or an answer called wrong. Hotkeys and screen analysis always think. A quick answer
// uses the model's own setting below; thinking uses the effort picked on the start screen (THINKING_EFFORTS).
// Measured on 2026-10-17 with the DSA coding prompt:
// - Haiku thinks 1,450-2,250 tokens at low, so its first text took 9-13 s; with reasoning off, 0.8-0.9 s.
// - Astra, Sol, Sonnet and Opus refuse reasoning off ("Reasoning is mandatory"). Astra at low thinks
//   0-130 tokens and starts a follow-up in 1.4-2.8 s (minimal was no faster); at medium a new DSA problem
//   started after 11.4 s. Opus starts a follow-up in 2.7 s at low against 5.0 s at medium. Sonnet took
//   4.4-5.4 s at both minimal and low, so it has no faster setting.
// firstTextMs is how long the model may take to show its first text before Gemini answers instead. For
// thinking it is the wait at low effort; a higher effort waits at least as long as THINKING_EFFORTS says.
/** @type {ModelChoice[]} */
const ANSWER_MODELS = [
    {
        id: 'openai/gpt-6-astra',
        label: 'GPT-6 Astra',
        provider: 'openai',
        reasoning: { quick: { effort: 'low' } },
        firstTextMs: { quick: 8000, think: 20000 },
    },
    {
        id: 'anthropic/claude-opus-5.5',
        label: 'Claude Opus 5.5',
        provider: 'anthropic',
        reasoning: { quick: { effort: 'low' } },
        firstTextMs: { quick: 8000, think: 20000 },
    },
    {
        id: 'anthropic/claude-sonnet-5.5',
        label: 'Claude Sonnet 5.5',
        provider: 'anthropic',
        reasoning: { quick: { effort: 'low' } },
        firstTextMs: { quick: 15000, think: 15000 },
    },
    {
        id: 'openai/gpt-6.1-sol',
        label: 'GPT-6.1 Sol',
        provider: 'openai',
        reasoning: { quick: { effort: 'low' } },
        firstTextMs: { quick: 8000, think: 8000 },
    },
    // DeepSeek's best (V4 Pro) can't read screenshots, so the Flash model, which can.
    {
        id: 'deepseek/deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash (very cheap)',
        provider: 'deepseek',
        reasoning: { quick: { enabled: false } },
        firstTextMs: { quick: 8000, think: 8000 },
    },
    {
        id: 'anthropic/claude-haiku-5.5',
        label: 'Claude Haiku 5.5 (cheapest, for testing)',
        provider: 'anthropic',
        reasoning: { quick: { enabled: false } },
        firstTextMs: { quick: 8000, think: 15000 },
    },
];

// How hard the answer model thinks on a 'think' turn, picked on the start screen (reasoningEffort in
// preferences). Thinking longer delays the first text, so a higher effort gives the model at least
// firstTextMs before Gemini steps in: room for the thinking, not a measurement.
const THINKING_EFFORTS = [
    { id: 'low', label: 'Low', firstTextMs: 0 },
    { id: 'medium', label: 'Medium', firstTextMs: 30000 },
    { id: 'high', label: 'High', firstTextMs: 60000 },
];
// Thinking counts against max_tokens, and OpenRouter gives an Anthropic model 80% of max_tokens to think at
// high effort, which would leave an 8,192-token answer about 1,600 tokens. High gets this much more room.
const HIGH_EFFORT_EXTRA_TOKENS = 12288;

/** @typedef {'quick'|'think'} AnswerDepth */
/** @typedef {{effort?: string, enabled?: boolean}} ReasoningSetting */
/** @typedef {{id: string, label: string, provider: string, reasoning: {quick: ReasoningSetting}, firstTextMs: Record<AnswerDepth, number>}} ModelChoice */
/** @typedef {ModelChoice & {reasoning: Record<AnswerDepth, ReasoningSetting>}} AnswerModel */
/** @typedef {{text: string, cost?: number}} AnswerResult */
/** @typedef {(options: {signal: AbortSignal, onText: (text: string) => void}) => Promise<AnswerResult>} AnswerStream */
/** @typedef {{role: 'user'|'assistant', text: string, imageJpeg?: string|null}} ChatMessage */

/** An unknown or missing effort falls back to low. @param {string|undefined} id */
function thinkingEffortById(id) {
    return THINKING_EFFORTS.find(effort => effort.id === id) || THINKING_EFFORTS[0];
}

/**
 * The model picked on the start screen, thinking at the effort picked there. An unknown or missing model
 * falls back to the first one.
 * @param {string|undefined} id @param {string} [effortId] @returns {AnswerModel}
 */
function answerModelById(id, effortId) {
    const model = ANSWER_MODELS.find(item => item.id === id) || ANSWER_MODELS[0];
    const effort = thinkingEffortById(effortId);
    return {
        ...model,
        reasoning: { ...model.reasoning, think: { effort: effort.id } },
        firstTextMs: { ...model.firstTextMs, think: Math.max(model.firstTextMs.think, effort.firstTextMs) },
    };
}

const CACHE_MARK = { prompt_cache_breakpoint: { mode: 'explicit' } };

/** @param {ChatMessage} message @param {boolean} cacheMark */
function openRouterContent(message, cacheMark) {
    if (!message.imageJpeg && !cacheMark) return message.text;
    const text = { type: 'text', text: message.text, ...(cacheMark ? CACHE_MARK : {}) };
    if (!message.imageJpeg) return [text];
    return [text, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${message.imageJpeg}` } }];
}

/**
 * @param {{model: AnswerModel, systemPrompt: string, messages: ChatMessage[], maxTokens: number, sessionId?: string, cacheConversation?: boolean, depth?: AnswerDepth}} request
 */
function buildOpenRouterAnswerRequest({ model, systemPrompt, messages, maxTokens, sessionId = '', cacheConversation = false, depth = 'think' }) {
    // OpenAI caches a growing conversation on its own; Anthropic only caches up to a marked block, so the
    // newest message carries the mark and Anthropic finds the earlier turns' cache from there.
    const markNewest = cacheConversation && model.provider === 'anthropic';
    const last = messages.length - 1;
    const reasoning = model.reasoning[depth];
    return {
        model: model.id,
        stream: true,
        max_tokens: maxTokens + (reasoning.effort === 'high' ? HIGH_EFFORT_EXTRA_TOKENS : 0),
        reasoning: { ...reasoning, exclude: true },
        usage: { include: true },
        provider: { order: [model.provider] },
        ...(sessionId ? { session_id: sessionId } : {}),
        // A one-question answer caches only the system prompt: its question part changes every time, so on
        // OpenAI it is billed as plain input instead of a 1.25x cache write. A coding round caches the whole
        // conversation, which only ever grows at the end.
        ...(cacheConversation ? {} : { prompt_cache_options: { mode: 'explicit' } }),
        messages: [
            { role: 'system', content: [{ type: 'text', text: systemPrompt, ...CACHE_MARK }] },
            ...messages.map((message, index) => ({ role: message.role, content: openRouterContent(message, markNewest && index === last) })),
        ],
    };
}

/**
 * Gemini takes 'model' for assistant turns and wants consecutive turns of the same role merged.
 * @param {ChatMessage[]} messages
 */
function toGeminiContents(messages) {
    /** @type {{role: 'user'|'model', parts: object[]}[]} */
    const contents = [];
    for (const message of messages) {
        const role = message.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        if (message.imageJpeg) parts.push({ inlineData: { mimeType: 'image/jpeg', data: message.imageJpeg } });
        parts.push({ text: message.text });
        const last = contents[contents.length - 1];
        if (last && last.role === role) last.parts.push(...parts);
        else contents.push({ role, parts });
    }
    return contents;
}

/**
 * Splits OpenRouter's server-sent events into JSON events; a network chunk can end anywhere in a line.
 * @param {(event: any) => void} onEvent
 */
function createSseParser(onEvent) {
    let buffer = '';
    return (/** @type {string} */ chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            // Lines starting with ':' are keep-alive comments such as ": OPENROUTER PROCESSING".
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            onEvent(JSON.parse(data));
        }
    };
}

/**
 * @param {{apiKey: string, model: AnswerModel, systemPrompt: string, messages: ChatMessage[], maxTokens: number, sessionId?: string,
 *   cacheConversation?: boolean, depth?: AnswerDepth, signal: AbortSignal, onText: (text: string) => void, fetchImpl?: typeof fetch}} options
 * @returns {Promise<AnswerResult>}
 */
async function streamOpenRouterAnswer({
    apiKey,
    model,
    systemPrompt,
    messages,
    maxTokens,
    sessionId = '',
    cacheConversation = false,
    depth = 'think',
    signal,
    onText,
    fetchImpl = fetch,
}) {
    const response = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOpenRouterAnswerRequest({ model, systemPrompt, messages, maxTokens, sessionId, cacheConversation, depth })),
        signal,
    });
    if (!response.ok) {
        throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const decoder = new TextDecoder();
    let text = '';
    let cost = 0;
    const parse = createSseParser(event => {
        if (event.error) throw new Error(`OpenRouter: ${event.error.message || JSON.stringify(event.error)}`);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
            text += delta;
            onText(text);
        }
        if (event.usage?.cost) cost = event.usage.cost;
    });
    for await (const chunk of response.body) parse(decoder.decode(chunk, { stream: true }));
    return { text, cost };
}

/**
 * Runs the primary answer and switches to the fallback only if no text has been shown yet,
 * including when the primary finishes without any text. A cancelled answer (a newer question arrived) never falls back.
 * @param {{primary: AnswerStream, fallback: AnswerStream, signal: AbortSignal, onText: (text: string) => void, firstTextTimeoutMs: number}} options
 * @returns {Promise<AnswerResult & {usedFallback: boolean, primaryError?: Error}>}
 */
async function answerWithFallback({ primary, fallback, signal, onText, firstTextTimeoutMs }) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error(`no text within ${firstTextTimeoutMs} ms`)), firstTextTimeoutMs);
    let sawText = false;
    let primaryError;
    try {
        const result = await primary({
            signal: AbortSignal.any([signal, timeout.signal]),
            onText: text => {
                if (!sawText) {
                    sawText = true;
                    clearTimeout(timer);
                }
                onText(text);
            },
        });
        if (result.text.trim()) return { ...result, usedFallback: false };
        primaryError = new Error('empty answer');
    } catch (error) {
        if (signal.aborted || sawText) throw error;
        primaryError = timeout.signal.aborted ? timeout.signal.reason : error;
    } finally {
        clearTimeout(timer);
    }
    const result = await fallback({ signal, onText });
    return { ...result, usedFallback: true, primaryError };
}

/**
 * One readable line for the status bar. Gemini's SDK puts the API's JSON body in the message, and that body can wrap another one.
 * @param {unknown} error
 */
function shortErrorMessage(error) {
    let text = String(error instanceof Error ? error.message : error);
    for (let depth = 0; depth < 3; depth++) {
        let inner;
        try {
            const parsed = JSON.parse(text);
            inner = parsed?.error?.message ?? parsed?.message;
        } catch {
            break;
        }
        if (typeof inner !== 'string') break;
        text = inner;
    }
    if (/exceeded your current quota/i.test(text)) {
        const [, hours = '', minutes = '', seconds = ''] = text.match(/retry in (\d+h)?(\d+m)?(?:([\d.]+)s)?/i) || [];
        const wait = hours || minutes ? `${hours}${minutes}` : seconds ? `${Math.ceil(Number(seconds))}s` : '';
        return `Gemini quota used up${/free_tier/.test(text) ? ' on the free tier' : ''}${wait ? `, retry in ${wait}` : ''}`;
    }
    const firstLine = text.trim().split('\n')[0];
    return firstLine.length > 160 ? `${firstLine.slice(0, 159)}…` : firstLine;
}

module.exports = {
    ANSWER_MODELS,
    THINKING_EFFORTS,
    thinkingEffortById,
    answerModelById,
    buildOpenRouterAnswerRequest,
    toGeminiContents,
    createSseParser,
    streamOpenRouterAnswer,
    answerWithFallback,
    shortErrorMessage,
};
