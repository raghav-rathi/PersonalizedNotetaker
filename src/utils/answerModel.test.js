const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    ANSWER_MODELS,
    answerModelById,
    buildOpenRouterAnswerRequest,
    toGeminiContents,
    createSseParser,
    streamOpenRouterAnswer,
    answerWithFallback,
    shortErrorMessage,
} = require('./answerModel');

const astra = answerModelById('openai/gpt-6-astra');
const opus = answerModelById('anthropic/claude-opus-5.5');

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
        model: astra,
        systemPrompt: 'system',
        messages: [{ role: 'user', text: 'Question:\nWhat is a DaemonSet?' }],
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
            model: astra,
            systemPrompt: 'system',
            messages: [{ role: 'user', text: 'question' }],
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
            model: astra,
            systemPrompt: 'system',
            messages: [{ role: 'user', text: 'question' }],
            maxTokens: 100,
            signal: new AbortController().signal,
            onText: text => shown.push(text),
            fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"User not found."}}' }),
        }),
        /OpenRouter 401/
    );
    assert.deepEqual(shown, []);
});

test('a coding conversation goes out oldest first, with each screenshot on the turn that sent it', () => {
    const request = buildOpenRouterAnswerRequest({
        model: astra,
        systemPrompt: 'skill',
        messages: [
            { role: 'user', text: 'NEW PROBLEM', imageJpeg: 'AAAA' },
            { role: 'assistant', text: 'LANE: MAIN\nPart 1' },
            { role: 'user', text: 'command: part two' },
        ],
        maxTokens: 100,
        cacheConversation: true,
    });
    assert.deepEqual(
        request.messages.map(message => message.role),
        ['system', 'user', 'assistant', 'user']
    );
    assert.deepEqual(request.messages[1].content, [
        { type: 'text', text: 'NEW PROBLEM' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
    assert.equal(request.messages[3].content, 'command: part two');
});

test('only a coding conversation is cached past the system prompt', () => {
    const messages = [{ role: 'user', text: 'question' }];
    const single = buildOpenRouterAnswerRequest({ model: astra, systemPrompt: 'system', messages, maxTokens: 100 });
    const coding = buildOpenRouterAnswerRequest({ model: astra, systemPrompt: 'system', messages, maxTokens: 100, cacheConversation: true });
    for (const request of [single, coding]) {
        assert.deepEqual(request.messages[0].content, [{ type: 'text', text: 'system', prompt_cache_breakpoint: { mode: 'explicit' } }]);
    }
    assert.deepEqual(single.prompt_cache_options, { mode: 'explicit' });
    assert.equal(coding.prompt_cache_options, undefined);
});

test('Opus goes to Anthropic first, and marks the newest coding turn so the conversation is cached', () => {
    const messages = [
        { role: 'user', text: 'NEW PROBLEM', imageJpeg: 'AAAA' },
        { role: 'assistant', text: 'LANE: MAIN\nPart 1' },
        { role: 'user', text: 'command: part two' },
    ];
    const request = buildOpenRouterAnswerRequest({ model: opus, systemPrompt: 'skill', messages, maxTokens: 100, cacheConversation: true });
    assert.equal(request.model, 'anthropic/claude-opus-5.5');
    assert.deepEqual(request.provider, { order: ['anthropic'] });
    assert.deepEqual(request.messages[3].content, [{ type: 'text', text: 'command: part two', prompt_cache_breakpoint: { mode: 'explicit' } }]);
    // Earlier turns go out unmarked, so their text matches what was cached on the turn before.
    assert.equal(request.messages[2].content, 'LANE: MAIN\nPart 1');
    assert.equal(request.messages[1].content[0].prompt_cache_breakpoint, undefined);
});

test("a quick answer keeps the model's own setting, and thinking uses the effort picked on the start screen", () => {
    const messages = [{ role: 'user', text: 'q' }];
    const reasoning = (id, effort, depth) =>
        buildOpenRouterAnswerRequest({ model: answerModelById(id, effort), systemPrompt: 'p', messages, maxTokens: 10, depth }).reasoning;
    for (const effort of ['low', 'medium', 'high']) {
        assert.deepEqual(reasoning('anthropic/claude-haiku-5.5', effort, 'quick'), { enabled: false, exclude: true });
        // Astra can't turn reasoning off, so its quick answers stay at low.
        assert.deepEqual(reasoning('openai/gpt-6-astra', effort, 'quick'), { effort: 'low', exclude: true });
        assert.deepEqual(reasoning('anthropic/claude-haiku-5.5', effort, 'think'), { effort, exclude: true });
        assert.deepEqual(reasoning('openai/gpt-6-astra', effort, undefined), { effort, exclude: true });
    }
    // Nothing picked yet, or a value this version doesn't know, thinks at low.
    assert.deepEqual(reasoning('openai/gpt-6-astra', undefined, 'think'), { effort: 'low', exclude: true });
    assert.deepEqual(reasoning('openai/gpt-6-astra', 'extreme', 'think'), { effort: 'low', exclude: true });
});

test('high effort leaves the answer room after the thinking, and more effort never waits less for the first text', () => {
    const opusAtHigh = answerModelById('anthropic/claude-opus-5.5', 'high');
    const { max_tokens } = buildOpenRouterAnswerRequest({
        model: opusAtHigh,
        systemPrompt: 'p',
        messages: [{ role: 'user', text: 'q' }],
        maxTokens: 8192,
    });
    // OpenRouter gives an Anthropic model 80% of max_tokens to think at high.
    assert.ok(max_tokens * 0.2 >= 4096, String(max_tokens));
    for (const model of ANSWER_MODELS) {
        const [low, medium, high] = ['low', 'medium', 'high'].map(effort => answerModelById(model.id, effort).firstTextMs);
        assert.ok(low.think >= low.quick && low.think <= medium.think && medium.think <= high.think, model.id);
    }
});

test('Sonnet, Haiku and DeepSeek go to their maker first', () => {
    for (const [id, provider] of [
        ['anthropic/claude-sonnet-5.5', 'anthropic'],
        ['anthropic/claude-haiku-5.5', 'anthropic'],
        ['deepseek/deepseek-v4.1-flash', 'deepseek'],
    ]) {
        const request = buildOpenRouterAnswerRequest({
            model: answerModelById(id),
            systemPrompt: 'p',
            messages: [{ role: 'user', text: 'q' }],
            maxTokens: 10,
        });
        assert.equal(request.model, id);
        assert.deepEqual(request.provider, { order: [provider] });
    }
});

test('a saved model that no longer exists falls back to the first model', () => {
    assert.equal(answerModelById('openai/retired-model').id, ANSWER_MODELS[0].id);
    assert.equal(answerModelById(undefined).id, ANSWER_MODELS[0].id);
});

test('the Gemini fallback gets the same conversation, with assistant turns as model turns', () => {
    const contents = toGeminiContents([
        { role: 'user', text: 'NEW PROBLEM', imageJpeg: 'AAAA' },
        // A turn whose reply never arrived leaves two user turns in a row.
        { role: 'user', text: 'they said: what about duplicates?' },
        { role: 'assistant', text: 'LANE: SIDE\nThey stay.' },
        { role: 'user', text: 'command: next step' },
    ]);
    assert.deepEqual(contents, [
        {
            role: 'user',
            parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: 'NEW PROBLEM' }, { text: 'they said: what about duplicates?' }],
        },
        { role: 'model', parts: [{ text: 'LANE: SIDE\nThey stay.' }] },
        { role: 'user', parts: [{ text: 'command: next step' }] },
    ]);
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
        firstTextTimeoutMs: astra.firstTextMs.quick,
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
            firstTextTimeoutMs: astra.firstTextMs.quick,
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
        firstTextTimeoutMs: astra.firstTextMs.quick,
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
        firstTextTimeoutMs: astra.firstTextMs.quick,
    });
    cancel.abort();
    await assert.rejects(pending);
    assert.equal(fallbackCalls, 0);
});

test('a failed answer shows one short line, and a used-up Gemini quota says when to retry', () => {
    const quotaBody = {
        error: {
            code: 429,
            message:
                'You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash\nPlease retry in 15h51m41.52597089s.',
            status: 'RESOURCE_EXHAUSTED',
        },
    };
    const quota = new Error(JSON.stringify({ error: { message: JSON.stringify(quotaBody), code: 429, status: 'Too Many Requests' } }));
    assert.equal(shortErrorMessage(quota), 'Gemini quota used up on the free tier, retry in 15h51m');
    assert.equal(shortErrorMessage(new Error('You exceeded your current quota. Please retry in 41.5s.')), 'Gemini quota used up, retry in 42s');
    assert.equal(
        shortErrorMessage(new Error('OpenRouter 401: {"error":{"message":"API key expired"}}')),
        'OpenRouter 401: {"error":{"message":"API key expired"}}'
    );
    assert.equal(shortErrorMessage(new Error(`fetch failed\n${'x'.repeat(300)}`)), 'fetch failed');
    assert.equal(shortErrorMessage(new Error('y'.repeat(200))).length, 160);
});
