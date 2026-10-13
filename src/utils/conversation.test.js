const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Conversation } = require('./conversation');

test('each turn sees every earlier message and reply so far, and its own message last', () => {
    const conversation = new Conversation();
    const problem = conversation.addTurn({ text: 'screen: This is my screen.', imageJpeg: 'AAAA' });
    problem.reply = 'LANE: MAIN\nOkay, so we have an array...';
    const answer = conversation.addTurn({ text: 'they said: yes, they can be negative' });
    // The brute force is still streaming when the interviewer cuts in.
    answer.reply = 'LANE: MAIN\nThe simplest way';
    const question = conversation.addTurn({ text: 'they said: why a map?' });
    assert.deepEqual(conversation.messagesThrough(question), [
        { role: 'user', text: 'screen: This is my screen.', imageJpeg: 'AAAA' },
        { role: 'assistant', text: 'LANE: MAIN\nOkay, so we have an array...' },
        { role: 'user', text: 'they said: yes, they can be negative', imageJpeg: null },
        { role: 'assistant', text: 'LANE: MAIN\nThe simplest way' },
        { role: 'user', text: 'they said: why a map?', imageJpeg: null },
    ]);
});

test('a failed or replaced turn leaves the conversation, and clearing starts it empty', () => {
    const conversation = new Conversation();
    const kept = conversation.addTurn({ text: 'they said: find two numbers that add up to k' });
    kept.reply = 'Okay, so we have';
    const failed = conversation.addTurn({ text: 'they said: can you do better' });
    conversation.removeTurn(failed);
    const retry = conversation.addTurn({ text: 'they said: can you do better' });
    assert.deepEqual(
        conversation.messagesThrough(retry).map(message => message.text),
        ['they said: find two numbers that add up to k', 'Okay, so we have', 'they said: can you do better']
    );
    conversation.clear();
    const fresh = conversation.addTurn({ text: 'NEW PROBLEM' });
    assert.deepEqual(conversation.messagesThrough(fresh), [{ role: 'user', text: 'NEW PROBLEM', imageJpeg: null }]);
});
