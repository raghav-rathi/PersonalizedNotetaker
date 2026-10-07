// In BYOK mode Gemini Live only listens. When an OpenRouter key is saved, GPT-6 Astra writes the answers
// through OpenRouter; otherwise, or when that request fails before any text arrives, Gemini Flash answers.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_ANSWER_MODEL = 'openai/gpt-6-astra';
const OPENROUTER_REASONING_EFFORT = 'low';
// Astra's first text normally arrives in 1-3 s; past this the answer switches to Gemini instead of leaving the card empty.
const FIRST_TEXT_TIMEOUT_MS = 8000;

/** @typedef {{text: string, cost?: number}} AnswerResult */
/** @typedef {(options: {signal: AbortSignal, onText: (text: string) => void}) => Promise<AnswerResult>} AnswerStream */

/**
 * @param {{systemPrompt: string, userText: string, imageJpeg?: string|null, maxTokens: number}} request
 */
function buildOpenRouterAnswerRequest({ systemPrompt, userText, imageJpeg = null, maxTokens }) {
    const content = imageJpeg
        ? [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageJpeg}` } },
          ]
        : userText;
    return {
        model: OPENROUTER_ANSWER_MODEL,
        stream: true,
        max_tokens: maxTokens,
        reasoning: { effort: OPENROUTER_REASONING_EFFORT, exclude: true },
        usage: { include: true },
        // The system prompt stays the first, unchanged message so OpenAI's prompt cache keeps hitting.
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content },
        ],
    };
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
 * @param {{apiKey: string, systemPrompt: string, userText: string, imageJpeg?: string|null, maxTokens: number,
 *   signal: AbortSignal, onText: (text: string) => void, fetchImpl?: typeof fetch}} options
 * @returns {Promise<AnswerResult>}
 */
async function streamOpenRouterAnswer({ apiKey, systemPrompt, userText, imageJpeg = null, maxTokens, signal, onText, fetchImpl = fetch }) {
    const response = await fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOpenRouterAnswerRequest({ systemPrompt, userText, imageJpeg, maxTokens })),
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
 * @param {{primary: AnswerStream, fallback: AnswerStream, signal: AbortSignal, onText: (text: string) => void, firstTextTimeoutMs?: number}} options
 * @returns {Promise<AnswerResult & {usedFallback: boolean, primaryError?: Error}>}
 */
async function answerWithFallback({ primary, fallback, signal, onText, firstTextTimeoutMs = FIRST_TEXT_TIMEOUT_MS }) {
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
    OPENROUTER_ANSWER_MODEL,
    FIRST_TEXT_TIMEOUT_MS,
    buildOpenRouterAnswerRequest,
    createSseParser,
    streamOpenRouterAnswer,
    answerWithFallback,
};
