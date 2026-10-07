const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextVoiceQuestion, questionText } = require('./questionMerge');

let ids = 0;
const newTurnId = () => `answer-${++ids}`;

test('pauses inside one question join every part into the same answer card', () => {
    const first = nextVoiceQuestion(null, { fragment: 'So tell me about', turnSeq: 1, now: 1000, newTurnId });
    const second = nextVoiceQuestion(first, { fragment: 'a time a GPU failed', turnSeq: 2, now: 5000, newTurnId });
    const third = nextVoiceQuestion(second, { fragment: 'in production.', turnSeq: 3, now: 17000, newTurnId });
    assert.equal(third.turnId, first.turnId);
    assert.equal(questionText(third), 'So tell me about a time a GPU failed in production.');
});

test('a later transcript snapshot of the same turn replaces its fragment instead of repeating it', () => {
    const first = nextVoiceQuestion(null, { fragment: 'And how do you upgrade', turnSeq: 7, now: 0, newTurnId });
    const grown = nextVoiceQuestion(first, { fragment: 'And how do you upgrade Kubernetes safely?', turnSeq: 7, now: 900, newTurnId });
    assert.equal(questionText(grown), 'And how do you upgrade Kubernetes safely?');
    assert.equal(grown.turnId, first.turnId);
});

test('a question after the merge window gets a new answer card', () => {
    const first = nextVoiceQuestion(null, { fragment: 'What is a DaemonSet?', turnSeq: 4, now: 0, newTurnId });
    const atLimit = nextVoiceQuestion(first, { fragment: 'And when would you not use one?', turnSeq: 5, now: 12000, newTurnId });
    const after = nextVoiceQuestion(atLimit, { fragment: 'How would you debug a Pending pod?', turnSeq: 6, now: 24001, newTurnId });
    assert.equal(atLimit.turnId, first.turnId);
    assert.notEqual(after.turnId, first.turnId);
    assert.equal(questionText(after), 'How would you debug a Pending pod?');
});
