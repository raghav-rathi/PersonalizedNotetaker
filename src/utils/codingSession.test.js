const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodingSession, loadCodingSkill, loadSessionSkill, ensureUserSkillFile } = require('./codingSession');

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

test('what I said goes before the question that followed it, even when it was written down after that question arrived', () => {
    const session = new CodingSession();
    session.startProblem();
    const first = session.addTurn({ text: 'they said: tell me about a project', at: 1000 });
    first.reply = 'LANE: MAIN\nThe research agent';
    const followUp = session.addTurn({ text: 'they said: why that database?', at: 9000 });
    session.addTurn({ text: 'I said: let me tell you about Braindecode instead', at: 8000 });
    assert.deepEqual(
        session.messagesThrough(followUp).map(message => `${message.role}: ${message.text}`),
        [
            'user: they said: tell me about a project',
            'assistant: LANE: MAIN\nThe research agent',
            'user: I said: let me tell you about Braindecode instead',
            'user: they said: why that database?',
        ]
    );
});

test('the round picks its prompt, a copy in the settings folder wins, and other profiles keep the DSA round', t => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-prompt-'));
    t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
    assert.match(loadCodingSkill('lld', configDir), /low-level design/i);
    assert.match(loadCodingSkill('hld', configDir), /system design/i);
    assert.equal(loadCodingSkill('interview', configDir), loadCodingSkill('coding', configDir));
    const copy = ensureUserSkillFile('hld', configDir);
    fs.writeFileSync(copy, 'my edited HLD prompt');
    assert.equal(loadCodingSkill('hld', configDir), 'my edited HLD prompt');
    // A second open keeps the edits.
    ensureUserSkillFile('hld', configDir);
    assert.equal(fs.readFileSync(copy, 'utf8'), 'my edited HLD prompt');
});

test('editing a session round prompt applies on the next read, and leaves the DSA prompt and the other round alone', t => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-round-prompt-'));
    t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
    fs.writeFileSync(ensureUserSkillFile('coding', configDir), 'Use Python for my DSA round.');
    const incidentPath = ensureUserSkillFile('devops', configDir);
    const experiencePath = ensureUserSkillFile('experience', configDir);
    assert.notEqual(incidentPath, experiencePath);
    fs.writeFileSync(incidentPath, 'Ask for the next evidence.');
    fs.writeFileSync(experiencePath, 'Answer from my background.');
    assert.equal(loadSessionSkill('devops', configDir), 'Ask for the next evidence.');
    assert.equal(loadSessionSkill('experience', configDir), 'Answer from my background.');
    fs.writeFileSync(incidentPath, 'Use only the captured evidence.');
    // A second open keeps the edits.
    ensureUserSkillFile('devops', configDir);
    ensureUserSkillFile('experience', configDir);
    assert.equal(loadSessionSkill('devops', configDir), 'Use only the captured evidence.');
    assert.equal(loadSessionSkill('experience', configDir), 'Answer from my background.');
    for (const profile of ['devops', 'experience']) assert.equal(loadCodingSkill(profile, configDir), 'Use Python for my DSA round.');
});
