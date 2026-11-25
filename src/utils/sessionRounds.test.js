const test = require('node:test');
const assert = require('node:assert/strict');

const { isSessionRound, startBlocker } = require('./sessionRounds');

test('a session round starts only on the BYOK session, and the experience round only with a background', () => {
    const start = options => startBlocker({ name: 'This round', providerMode: 'byok', ...options });

    assert.equal(start({ profile: 'devops' }), '');
    assert.ok(start({ profile: 'devops', providerMode: 'cloud' }));
    assert.ok(start({ profile: 'experience', providerMode: 'local', experienceContext: 'Five years at Acme.' }));

    assert.ok(start({ profile: 'experience' }));
    assert.ok(start({ profile: 'experience', experienceContext: '  \n ' }));
    assert.equal(start({ profile: 'experience', experienceContext: 'Five years at Acme.' }), '');

    // Other profiles never needed either.
    assert.equal(start({ profile: 'interview', providerMode: 'cloud' }), '');
    assert.equal(isSessionRound('interview'), false);
    assert.equal(isSessionRound('toString'), false);
    assert.equal(isSessionRound(null), false);
});
