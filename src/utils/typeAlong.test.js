const { test } = require('node:test');
const assert = require('node:assert/strict');
const { typedLines } = require('./typeAlong');

test('only the lines inside code and pad blocks are typed, in order, with their indentation', () => {
    const answer = [
        '**Hop 1 of 3: setup**',
        '',
        "I'll count first.",
        '```python',
        'def top_k(nums, k):',
        '    # one pass, so each count is ready',
        '',
        '    count = Counter(nums)',
        '```',
        'Remaining: loop, return',
        '```text',
        'Better',
        '```',
    ].join('\n');
    assert.deepEqual(typedLines(answer), ['def top_k(nums, k):', '    # one pass, so each count is ready', '    count = Counter(nums)', 'Better']);
});

test('a block that is still streaming already gives the lines written so far', () => {
    assert.deepEqual(typedLines('Say this.\n```python\ndef f(x):\n    return x'), ['def f(x):', '    return x']);
});

test('an answer without code has nothing to type', () => {
    assert.deepEqual(typedLines('Why a set? Because the check is constant time.'), []);
});
