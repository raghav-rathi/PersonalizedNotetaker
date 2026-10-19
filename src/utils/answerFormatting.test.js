const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatLiveAnswerText, formatAnswerForDisplay, splitCodeColumn, escapeHtml, safeMarkdownRenderer } = require('./answerFormatting');
const marked = require('../assets/marked-4.3.0.min.js');

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

test('markup quoted in an answer shows as text, and only web and mail links stay links', () => {
    const renderer = safeMarkdownRenderer(marked);
    const render = text => marked.parse(text, { gfm: true, breaks: true, renderer });
    assert.match(render('The body has <img src=x onerror=alert(1)> in it'), /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(render('<script>alert(1)</script>\n\nnext'), /<script>/);
    assert.match(render('Use a List<Integer> here'), /List&lt;Integer&gt;/);
    assert.match(render('| field | value |\n|---|---|\n| kid | <b>missing</b> |'), /&lt;b&gt;missing&lt;\/b&gt;/);
    assert.equal(render('[docs](javascript:alert(1))'), '<p>docs</p>\n');
    assert.match(render('[runbook](https://example.com/rb)'), /<a href="https:\/\/example.com\/rb">runbook<\/a>/);
    assert.match(render('```html\n<div>x</div>\n```'), /&lt;div&gt;x&lt;\/div&gt;/);
    assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});
