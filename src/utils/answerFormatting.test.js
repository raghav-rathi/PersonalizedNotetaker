const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatLiveAnswerText, formatAnswerForDisplay, splitCodeColumn } = require('./answerFormatting');

test('splits Question / Answer / Why labels into separate paragraphs', () => {
    const text = '**Question**: Is there a src folder? **Answer**: Yes. **Why**: It is visible on the left.';
    assert.equal(formatLiveAnswerText(text), '**Question**: Is there a src folder?\n\n**Answer**: Yes.\n\n**Why**: It is visible on the left.');
});

test('handles colon-inside-bold labels and LLD section words', () => {
    assert.equal(formatLiveAnswerText('**Answer:** Yes. **Why:** Because.'), '**Answer:** Yes.\n\n**Why:** Because.');
    assert.equal(formatLiveAnswerText('**STATE** null · OOD **SPEAK** Ready when you are.'), '**STATE** null · OOD\n\n**SPEAK** Ready when you are.');
    assert.equal(formatLiveAnswerText('STATE: parking lot SPEAK: Let us start.'), 'STATE: parking lot\n\nSPEAK: Let us start.');
});

test('leaves inline emphasis, code fences and already formatted text alone', () => {
    assert.equal(formatLiveAnswerText('Use the **API** for **fast** reads.'), 'Use the **API** for **fast** reads.');
    const fenced = '**Answer**: see\n\n```js\nconst a = { "**Why**:": 1 };\n```';
    assert.equal(formatLiveAnswerText(fenced), fenced);
    const formatted = '**Question**: A?\n\n**Answer**: B.';
    assert.equal(formatLiveAnswerText(formatted), formatted);
});

test('script labels outside code become reading cues, and code blocks stay exactly as typed', () => {
    const reply = [
        'SAY:',
        "I'll start with a set.",
        '```python',
        '# SAY: not a label in code',
        'seen = set()',
        '```',
        'LISTEN: for their answer',
        '**ACTION:** replace line 3',
    ].join('\n');
    assert.equal(
        formatAnswerForDisplay(reply),
        [
            "I'll start with a set.",
            '```python',
            '# SAY: not a label in code',
            'seen = set()',
            '```',
            '**Listen** for their answer',
            '**Edit** replace line 3',
        ].join('\n')
    );
});

test('a trace walkthrough is read, not typed, and stays in the explanation column', () => {
    const answer = [
        'I can relate this to a BST.',
        '```trace',
        'visit 1 -> count=1',
        '```',
        '```java',
        'int kth(Node root, int k) {',
        '```',
        'That is O(h + k).',
    ].join('\n');
    assert.deepEqual(splitCodeColumn(answer), {
        left: ['I can relate this to a BST.', '```trace', 'visit 1 -> count=1', '```', 'That is O(h + k).'].join('\n'),
        right: ['```java', 'int kth(Node root, int k) {', '```'].join('\n'),
    });
});

test('a code block still streaming goes to the code column, and prose alone has no code column', () => {
    assert.deepEqual(splitCodeColumn('Say this.\n```java\nint x = 1;'), { left: 'Say this.', right: '```java\nint x = 1;' });
    assert.deepEqual(splitCodeColumn('Just words.'), { left: 'Just words.', right: '' });
});
