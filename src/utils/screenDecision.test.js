const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SENSITIVITY, buildScreenDecisionRequest, screenAction, answerDepth, announcesShare, decideScreen } = require('./screenDecision');

test('Jev gets the recent conversation and the latest line as text, and one now/wait/no question', () => {
    const request = buildScreenDecisionRequest({ recent: "they said: I'm sharing a doc.", latest: 'What about section two?' });
    assert.equal(request.model, 'typesafe/jev-1.14');
    assert.equal(request.state, "Earlier: they said: I'm sharing a doc.\nLatest line from the other person: What about section two?");
    assert.deepEqual(Object.keys(request.questions.screen.criteria), ['now', 'wait', 'no']);
    assert.match(buildScreenDecisionRequest({ latest: 'check my code', typed: true }).state, /^Latest line typed by the user: check my code$/);
});

test('the sensitivity decides how sure Jev must be before the screen is attached', () => {
    const unsure = { choice: 'no', probabilities: { now: 0.32, wait: 0, no: 0.68 } };
    assert.equal(screenAction(unsure, SENSITIVITY.more), 'now');
    assert.equal(screenAction(unsure, SENSITIVITY.balanced), 'no');
    assert.equal(screenAction({ choice: 'wait', probabilities: { now: 0.19, wait: 0.72, no: 0.09 } }, SENSITIVITY.balanced), 'wait');
    assert.equal(screenAction({ choice: 'now', probabilities: { now: 0.6 } }, SENSITIVITY.fewer), 'no');
});

test('a failed or slow decision is null, so the answer goes on without the screen', async () => {
    const options = { apiKey: 'k', latest: 'q', threshold: 0.5 };
    assert.equal(await decideScreen({ ...options, fetchImpl: async () => ({ ok: false }) }), null);
    const hang = (url, { signal }) =>
        new Promise((resolve, reject) => (signal.aborted ? reject(signal.reason) : signal.addEventListener('abort', () => reject(signal.reason))));
    assert.equal(await decideScreen({ ...options, fetchImpl: hang, timeoutMs: 20 }), null);
    assert.equal(await decideScreen({ ...options, fetchImpl: hang, signal: AbortSignal.abort() }), null);
    const ok = async () => ({ ok: true, json: async () => ({ answers: { screen: { choice: 'now', probabilities: { now: 0.97 } } } }) });
    assert.equal((await decideScreen({ ...options, fetchImpl: ok })).action, 'now');
    // Without a depth answer the model thinks, as before Jev chose.
    assert.equal((await decideScreen({ ...options, fetchImpl: ok })).depth, 'think');
});

test('the same Jev call decides whether the answer is quick or needs thinking', async () => {
    assert.deepEqual(Object.keys(buildScreenDecisionRequest({ latest: 'q' }).questions.depth.criteria), ['quick', 'think']);
    assert.ok(buildScreenDecisionRequest({ latest: 'q', profile: 'meeting' }).questions.depth);
    assert.equal(answerDepth({ choice: 'quick', probabilities: { quick: 0.99, think: 0.01 } }), 'quick');
    assert.equal(answerDepth({ choice: 'think', probabilities: { quick: 0.02, think: 0.98 } }), 'think');
    assert.equal(answerDepth({ choice: 'quick' }), 'quick');
    assert.equal(answerDepth(undefined), 'think');
    const answers = {
        screen: { choice: 'no', probabilities: { now: 0.01 } },
        depth: { choice: 'think', probabilities: { quick: 0.01, think: 0.99 } },
    };
    const decision = await decideScreen({
        apiKey: 'k',
        latest: 'You are wrong.',
        threshold: 0.5,
        fetchImpl: async () => ({ ok: true, json: async () => ({ answers }) }),
    });
    assert.equal(decision.depth, 'think');
    assert.equal(decision.thinkProbability, 0.99);
});

test('a line that announces sharing counts as sharing even when Jev leans to "now"', () => {
    assert.equal(announcesShare({ action: 'now', probabilities: { now: 0.69, wait: 0.24, no: 0.07 } }), true);
    assert.equal(announcesShare({ action: 'now', probabilities: { now: 0.56, wait: 0.09, no: 0.35 } }), false);
    assert.equal(announcesShare({ action: 'wait', probabilities: {} }), true);
});

test('a meeting asks Jev a stricter two-way question: attach only when the answer must point at the screen', () => {
    const request = buildScreenDecisionRequest({ latest: "I'm sharing Splunk now", profile: 'meeting' });
    assert.deepEqual(Object.keys(request.questions.screen.criteria), ['now', 'no']);
    assert.deepEqual(Object.keys(buildScreenDecisionRequest({ latest: 'q', profile: 'interview' }).questions.screen.criteria), ['now', 'wait', 'no']);
});
