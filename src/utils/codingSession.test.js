const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodingSession, NEW_INCIDENT_WORDS, loadCodingSkill, loadIncidentSkill, ensureUserSkillFile, clipEvidence } = require('./codingSession');

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

test('the round picks its prompt, a copy in the settings folder wins, and other profiles keep the DSA round', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-prompt-'));
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

test('DevOps mode answers from its own prompt, edits win, and its coding hotkeys keep the DSA round', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-prompt-'));
    assert.match(loadIncidentSkill(configDir), /incident/i);
    assert.equal(loadCodingSkill('devops', configDir), loadCodingSkill('coding', configDir));
    const copy = ensureUserSkillFile('devops', configDir);
    assert.equal(path.basename(copy), 'devops-skill.md');
    fs.writeFileSync(copy, 'my edited DevOps prompt');
    assert.equal(loadIncidentSkill(configDir), 'my edited DevOps prompt');
    assert.equal(loadCodingSkill('devops', configDir), loadCodingSkill('coding', configDir));
});

test('only the first screenshot and the three newest go along, and the others say they were left out', () => {
    const session = new CodingSession();
    session.startProblem();
    ['alert', 'runbook', 'diff', 'logs', 'status page', 'metrics'].forEach((name, index) => {
        session.addTurn({ text: `screen: ${name}`, imageJpeg: `IMG${index}` }).reply = `LANE: MAIN\nread the ${name}`;
    });
    const question = session.addTurn({ text: 'they said: are we recovered?' });
    const sent = session.messagesThrough(question).filter(message => message.role === 'user');
    assert.deepEqual(
        sent.map(message => message.imageJpeg),
        ['IMG0', null, null, 'IMG3', 'IMG4', 'IMG5', null]
    );
    assert.equal(sent[1].text, 'screen: runbook\n(The screenshot sent with this message is left out now, to keep the request small.)');
    assert.equal(sent[3].text, 'screen: logs');
    assert.equal(session.turns[1].imageJpeg, 'IMG1');
});

test('pasted text keeps its lines, and a huge paste keeps its start and its end', () => {
    assert.equal(clipEvidence('  line 1\r\nline 2\r\n  '), 'line 1\nline 2');
    const clipped = clipEvidence(`${'a'.repeat(15000)}${'b'.repeat(15000)}`, 20000);
    assert.equal(clipped, `${'a'.repeat(10000)}\n[... 10000 characters cut ...]\n${'b'.repeat(10000)}`);
});

test('"new incident" can carry the text typed after it', () => {
    const typed = 'New incident: checkout is down';
    assert.equal(typed.slice(typed.match(NEW_INCIDENT_WORDS)[0].length), 'checkout is down');
    assert.ok(NEW_INCIDENT_WORDS.test('new incident'));
    assert.equal(NEW_INCIDENT_WORDS.test('a new incident started'), false);
});
