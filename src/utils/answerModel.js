// In BYOK mode Gemini Live only listens. When an OpenRouter key is saved, the model picked on the start
// screen writes the answers through OpenRouter; otherwise, or when that request fails before any text
// arrives, Gemini Flash answers.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// The start screen lists these. Each provider keeps its own prompt cache, so a model goes to its maker's
// servers first, and the other providers OpenRouter has for it serve only as fallbacks.
// firstTextMs is how long the model may take to show its first text before Gemini answers instead.
// Astra and Sol start in 1-3 s. Opus at medium effort thinks first: in a 2026-10-09 test of 16 interview
// answers its first text came after a median 5.2 s and at most 13.8 s.
const ANSWER_MODELS = [
    { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra', effort: 'low', provider: 'openai', firstTextMs: 8000 },
    { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', effort: 'medium', provider: 'anthropic', firstTextMs: 20000 },
    { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol (cheapest, for testing)', effort: 'low', provider: 'openai', firstTextMs: 8000 },
];

/** @typedef {typeof ANSWER_MODELS[number]} AnswerModel */
/** @typedef {{text: string, cost?: number}} AnswerResult */
/** @typedef {(options: {signal: AbortSignal, onText: (text: string) => void}) => Promise<AnswerResult>} AnswerStream */
/** @typedef {{role: 'user'|'assistant', text: string, imageJpeg?: string|null}} ChatMessage */

/** An unknown or missing choice falls back to the first model. @param {string|undefined} id @returns {AnswerModel} */
function answerModelById(id) {
    return ANSWER_MODELS.find(model => model.id === id) || ANSWER_MODELS[0];
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
 * @param {{model: AnswerModel, systemPrompt: string, messages: ChatMessage[], maxTokens: number, sessionId?: string, cacheConversation?: boolean}} request
 */
function buildOpenRouterAnswerRequest({ model, systemPrompt, messages, maxTokens, sessionId = '', cacheConversation = false }) {
    // OpenAI caches a growing conversation on its own; Anthropic only caches up to a marked block, so the
    // newest message carries the mark and Anthropic finds the earlier turns' cache from there.
    const markNewest = cacheConversation && model.provider === 'anthropic';
    const last = messages.length - 1;
    return {
        model: model.id,
        stream: true,
        max_tokens: maxTokens,
        reasoning: { effort: model.effort, exclude: true },
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
 *   cacheConversation?: boolean, signal: AbortSignal, onText: (text: string) => void, fetchImpl?: typeof fetch}} options
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
    signal,
    onText,
    fetchImpl = fetch,
}) {
    const response = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOpenRouterAnswerRequest({ model, systemPrompt, messages, maxTokens, sessionId, cacheConversation })),
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

module.exports = {
    ANSWER_MODELS,
    answerModelById,
    buildOpenRouterAnswerRequest,
    toGeminiContents,
    createSseParser,
    streamOpenRouterAnswer,
    answerWithFallback,
};
