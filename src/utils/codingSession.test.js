const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodingSession, loadCodingSkill, loadIncidentSkill, ensureUserSkillFile } = require('./codingSession');

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

test('an edited round prompt wins, and other profiles keep the DSA round', t => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-prompt-'));
    t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
    assert.equal(loadCodingSkill('interview', configDir), loadCodingSkill('coding', configDir));
    const copy = ensureUserSkillFile('hld', configDir);
    fs.writeFileSync(copy, 'my edited HLD prompt');
    assert.equal(loadCodingSkill('hld', configDir), 'my edited HLD prompt');
    // A second open keeps the edits.
    ensureUserSkillFile('hld', configDir);
    assert.equal(fs.readFileSync(copy, 'utf8'), 'my edited HLD prompt');
});

test('editing the incident prompt applies on the next read without changing the DSA prompt', t => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-prompt-'));
    t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
    fs.writeFileSync(ensureUserSkillFile('coding', configDir), 'Use Python for my DSA round.');
    const incidentPath = ensureUserSkillFile('devops', configDir);
    fs.writeFileSync(incidentPath, 'Ask for the next evidence.');
    assert.equal(loadIncidentSkill(configDir), 'Ask for the next evidence.');
    assert.equal(loadCodingSkill('devops', configDir), 'Use Python for my DSA round.');
    fs.writeFileSync(incidentPath, 'Use only the captured evidence.');
    ensureUserSkillFile('devops', configDir);
    assert.equal(loadIncidentSkill(configDir), 'Use only the captured evidence.');
    assert.equal(loadCodingSkill('devops', configDir), 'Use Python for my DSA round.');
});
