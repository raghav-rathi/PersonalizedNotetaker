const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodingSession } = require('./codingSession');

test('each turn sees the problem, every earlier reply so far, and its own message last', () => {
    const session = new CodingSession();
    session.startProblem();
    const problem = session.addTurn({ text: 'NEW PROBLEM', imageJpeg: 'AAAA' });
    problem.reply = 'LANE: MAIN\nPart 1';
    const next = session.addTurn({ text: 'command: part two' });
    // Part 2 is still streaming when the interviewer cuts in.
    next.reply = 'LANE: MAIN\nThe slow part';
    const question = session.addTurn({ text: 'they said: why a set?' });
    assert.deepEqual(session.messagesThrough(question), [
        { role: 'user', text: 'NEW PROBLEM', imageJpeg: 'AAAA' },
        { role: 'assistant', text: 'LANE: MAIN\nPart 1' },
        { role: 'user', text: 'command: part two', imageJpeg: null },
        { role: 'assistant', text: 'LANE: MAIN\nThe slow part' },
        { role: 'user', text: 'they said: why a set?', imageJpeg: null },
    ]);
});

test('a failed turn leaves the conversation, and a new problem starts empty', () => {
    const session = new CodingSession();
    session.startProblem();
    const kept = session.addTurn({ text: 'NEW PROBLEM' });
    kept.reply = 'Part 1';
    const failed = session.addTurn({ text: 'command: part two' });
    session.removeTurn(failed);
    const retry = session.addTurn({ text: 'command: part two' });
    assert.deepEqual(
        session.messagesThrough(retry).map(message => message.text),
        ['NEW PROBLEM', 'Part 1', 'command: part two']
    );
    session.startProblem();
    const fresh = session.addTurn({ text: 'NEW PROBLEM' });
    assert.deepEqual(session.messagesThrough(fresh), [{ role: 'user', text: 'NEW PROBLEM', imageJpeg: null }]);
});
