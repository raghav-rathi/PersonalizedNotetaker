const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLaneHeader, splitSideUpdate, splitMainLesson, isReplaceableAnswer, resolveLane, isBackchannel } = require('./answerLanes');

test('a streaming reply waits for the whole LANE line, then shows only the answer', () => {
    assert.deepEqual(parseLaneHeader('LA'), { status: 'pending' });
    assert.deepEqual(parseLaneHeader('LANE: SI'), { status: 'pending' });
    assert.deepEqual(parseLaneHeader('LANE: SIDE\nIt is O(n).'), { status: 'done', lane: 'side', body: 'It is O(n).' });
    assert.deepEqual(parseLaneHeader('**LANE: MAIN**\n\nSAY:\nHi'), { status: 'done', lane: 'main', body: 'SAY:\nHi' });
});

test('a reply that ends right after its LANE line still counts', () => {
    assert.deepEqual(parseLaneHeader('LANE: NONE'), { status: 'done', lane: 'none', body: '' });
});

test('a reply without a LANE line is shown whole', () => {
    assert.deepEqual(parseLaneHeader('SAY: hello'), { status: 'done', lane: null, body: 'SAY: hello' });
    const long = 'L'.repeat(60);
    assert.deepEqual(parseLaneHeader(long), { status: 'done', lane: null, body: long });
});

test('a follow-up answer splits from the changed step at an UPDATE line outside code', () => {
    const body = [
        'Right, check it first.',
        '```text',
        'UPDATE:',
        '```',
        '**UPDATE:**',
        '**Hop 1 of 3: setup (changed)**',
        '```python',
        'x = 1',
        '```',
    ].join('\n');
    assert.deepEqual(splitSideUpdate(body), {
        answer: ['Right, check it first.', '```text', 'UPDATE:', '```'].join('\n'),
        update: ['**Hop 1 of 3: setup (changed)**', '```python', 'x = 1', '```'].join('\n'),
    });
    assert.deepEqual(splitSideUpdate('Just the answer.'), { answer: 'Just the answer.', update: null });
});

test('a main coding reply splits the lesson at a TEACH line outside code', () => {
    const body = [
        '**Part 1: clarify and simple version**',
        'I check every pair.',
        '```text',
        'TEACH:',
        '```',
        'TEACH:',
        'By hand you point at each pair.',
    ].join('\n');
    assert.deepEqual(splitMainLesson(body), {
        answer: ['**Part 1: clarify and simple version**', 'I check every pair.', '```text', 'TEACH:', '```'].join('\n'),
        lesson: 'By hand you point at each pair.',
    });
    assert.deepEqual(splitMainLesson('Just the script.'), { answer: 'Just the script.', lesson: null });
});

test('new speech may rewrite an answer only until it has been on screen for the grace period', () => {
    assert.equal(isReplaceableAnswer({ text: '', now: 99999 }), true);
    assert.equal(isReplaceableAnswer({ text: 'Started', firstTextAt: 1000, now: 6000, graceMs: 5000 }), true);
    assert.equal(isReplaceableAnswer({ text: 'Started', firstTextAt: 1000, now: 6001, graceMs: 5000 }), false);
});

test('a follow-up with no main answer on screen goes to the main screen', () => {
    assert.equal(resolveLane('side', { hasMainAnswer: false }), 'main');
    assert.equal(resolveLane('side', { hasMainAnswer: true }), 'side');
    assert.equal(resolveLane(null, { hasMainAnswer: true }), 'main');
    assert.equal(resolveLane('none', { hasMainAnswer: false }), 'none');
});

test('acknowledgements are recognised, questions and "go ahead" are not', () => {
    for (const text of ['Okay.', 'Mm-hmm, yeah.', 'Sounds good!', 'Got it, thanks.', 'uh huh']) assert.equal(isBackchannel(text), true, text);
    for (const text of ['Okay, so what is the time complexity?', 'Go ahead.', 'Yes, return the indices.', ''])
        assert.equal(isBackchannel(text), false, text);
});
