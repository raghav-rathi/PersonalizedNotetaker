const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenRouterAnswerRequest, createSseParser, streamOpenRouterAnswer, answerWithFallback } = require('./answerModel');

function sseResponse(text, chunkSize = 7) {
    const bytes = new TextEncoder().encode(text);
    return {
        ok: true,
        body: (async function* () {
            for (let i = 0; i < bytes.length; i += chunkSize) yield bytes.slice(i, i + chunkSize);
        })(),
    };
}

const delta = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

test('SSE events split anywhere across network chunks are reassembled in order', () => {
    const events = [];
    const parse = createSseParser(event => events.push(event));
    const stream = `: OPENROUTER PROCESSING\n\n${delta('Hel')}${delta('lo')}data: [DONE]\n\n`;
    for (let i = 0; i < stream.length; i += 5) parse(stream.slice(i, i + 5));
    assert.deepEqual(
        events.map(event => event.choices[0].delta.content),
        ['Hel', 'lo']
    );
});

test('streams the answer as it arrives and reports what the request cost', async () => {
    const shown = [];
    const usage = `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { cost: 0.0312 } })}\n\n`;
    const result = await streamOpenRouterAnswer({
        apiKey: 'key',
        systemPrompt: 'system',
        userText: 'Question:\nWhat is a DaemonSet?',
        maxTokens: 100,
        signal: new AbortController().signal,
        onText: text => shown.push(text),
        fetchImpl: async () => sseResponse(`${delta('It runs ')}${delta('one pod per node.')}${usage}data: [DONE]\n\n`),
    });
    assert.deepEqual(shown, ['It runs ', 'It runs one pod per node.']);
    assert.equal(result.text, 'It runs one pod per node.');
    assert.equal(result.cost, 0.0312);
});

test('an error from OpenRouter in the middle of the stream fails the answer', async () => {
    const error = `data: ${JSON.stringify({ error: { message: 'Provider returned error' }, choices: [{ delta: {}, finish_reason: 'error' }] })}\n\n`;
    await assert.rejects(
        streamOpenRouterAnswer({
            apiKey: 'key',
            systemPrompt: 'system',
            userText: 'question',
            maxTokens: 100,
            signal: new AbortController().signal,
            onText: () => {},
            fetchImpl: async () => sseResponse(`${delta('Partial')}${error}`),
        }),
        /Provider returned error/
    );
});

test('a rejected key fails before any text is shown', async () => {
    const shown = [];
    await assert.rejects(
        streamOpenRouterAnswer({
            apiKey: 'bad',
            systemPrompt: 'system',
            userText: 'question',
            maxTokens: 100,
            signal: new AbortController().signal,
            onText: text => shown.push(text),
            fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"User not found."}}' }),
        }),
        /OpenRouter 401/
    );
    assert.deepEqual(shown, []);
});

test('a screenshot goes with the question only when one is attached', () => {
    const plain = buildOpenRouterAnswerRequest({ systemPrompt: 'system', userText: 'question', maxTokens: 100 });
    assert.equal(plain.messages[1].content, 'question');
    const withImage = buildOpenRouterAnswerRequest({ systemPrompt: 'system', userText: 'question', imageJpeg: 'AAAA', maxTokens: 100 });
    assert.deepEqual(withImage.messages[1].content, [
        { type: 'text', text: 'question' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
    assert.deepEqual(withImage.messages[0], { role: 'system', content: 'system' });
});

test('Gemini answers when Astra fails before showing any text', async () => {
    const shown = [];
    const result = await answerWithFallback({
        primary: async () => {
            throw new Error('OpenRouter 401: User not found.');
        },
        fallback: async ({ onText }) => {
            onText('Gemini answer');
            return { text: 'Gemini answer' };
        },
        signal: new AbortController().signal,
        onText: text => shown.push(text),
    });
    assert.equal(result.text, 'Gemini answer');
    assert.equal(result.usedFallback, true);
    assert.match(result.primaryError.message, /401/);
    assert.deepEqual(shown, ['Gemini answer']);
});

test('a failure after text is already on screen keeps that answer instead of switching models', async () => {
    let fallbackCalls = 0;
    await assert.rejects(
        answerWithFallback({
            primary: async ({ onText }) => {
                onText('Half an answer');
                throw new Error('connection reset');
            },
            fallback: async () => {
                fallbackCalls++;
                return { text: 'Gemini answer' };
            },
            signal: new AbortController().signal,
            onText: () => {},
        }),
        /connection reset/
    );
    assert.equal(fallbackCalls, 0);
});

test('a primary that sends nothing before the first-text timeout is cancelled and Gemini answers', async () => {
    let primaryCancelled = false;
    const result = await answerWithFallback({
        primary: ({ signal }) =>
            new Promise((_, reject) =>
                signal.addEventListener('abort', () => {
                    primaryCancelled = true;
                    reject(signal.reason);
                })
            ),
        fallback: async () => ({ text: 'Gemini answer' }),
        signal: new AbortController().signal,
        onText: () => {},
        firstTextTimeoutMs: 20,
    });
    assert.equal(primaryCancelled, true);
    assert.equal(result.text, 'Gemini answer');
    assert.match(result.primaryError.message, /no text within 20 ms/);
});

test('an empty answer from the primary falls back to Gemini', async () => {
    const result = await answerWithFallback({
        primary: async () => ({ text: '  ' }),
        fallback: async () => ({ text: 'Gemini answer' }),
        signal: new AbortController().signal,
        onText: () => {},
    });
    assert.equal(result.text, 'Gemini answer');
    assert.equal(result.primaryError.message, 'empty answer');
});

test('an answer cancelled by a newer question never falls back', async () => {
    const cancel = new AbortController();
    let fallbackCalls = 0;
    const pending = answerWithFallback({
        primary: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
        fallback: async () => {
            fallbackCalls++;
            return { text: 'Gemini answer' };
        },
        signal: cancel.signal,
        onText: () => {},
    });
    cancel.abort();
    await assert.rejects(pending);
    assert.equal(fallbackCalls, 0);
});
