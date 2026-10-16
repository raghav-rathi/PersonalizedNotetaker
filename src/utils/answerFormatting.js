// Gemini Live answers arrive as a transcript of the spoken reply, so every newline is lost and
// "**Question**: … **Answer**: … **Why**: …" collapses into one paragraph. Restore the breaks.

const SECTION_WORDS = 'STATE|SPEAK|WRITE|LISTEN|ACTION';
const LABEL_AHEAD = new RegExp(
    [
        String.raw`\*\*[A-Za-z][^*\n]{0,40}?:\*\*`, // **Answer:**
        String.raw`\*\*[A-Za-z][^*\n]{0,40}?\*\*:`, // **Answer**:
        String.raw`\*\*(?:${SECTION_WORDS})\*\*`, // **SPEAK**
        String.raw`\b(?:${SECTION_WORDS}):`, // SPEAK:
    ].join('|')
);
const BREAK_BEFORE_LABEL = new RegExp(String.raw`[ \t]*\n?[ \t]*(?=${LABEL_AHEAD.source})`, 'g');

/** @param {string} text */
function formatLiveAnswerText(text) {
    return String(text || '')
        .split(/(```[\s\S]*?```)/)
        .map((part, index) => (index % 2 ? part : part.replace(BREAK_BEFORE_LABEL, (match, offset) => (offset === 0 ? '' : '\n\n'))))
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Script labels are for the model, not the reader. SAY/SPEAK/WRITE disappear (paragraphs are spoken,
// code blocks are typed), and cues such as LISTEN or LINE COACH become the small accent labels that
// AssistantView styles from a leading <strong>.
/** Matches a label at line start in any of SAY: / **SAY**: / **SAY:** forms. */
const label = name => new RegExp(String.raw`^(\s*)(?:\*\*)?(?:${name})(?:\*\*)?\s*:(?:\*\*)?\s*`, 'i');
const DISPLAY_LABELS = [
    [label('SAY|SPEAK|WRITE'), '$1'],
    [label('LISTEN'), '$1**Listen** '],
    [label('ACTION'), '$1**Edit** '],
    [label('CODE'), '$1**Code** '],
    [label('LINE COACH'), '$1**Line coach** '],
    [label('COMPLEXITY'), '$1**Complexity** '],
];

/** @param {string} text */
function formatAnswerForDisplay(text) {
    let inFence = false;
    return String(text || '')
        .split('\n')
        .map(line => {
            if (/^\s*```/.test(line)) {
                inFence = !inFence;
                return line;
            }
            if (inFence) return line;
            const rule = DISPLAY_LABELS.find(([pattern]) => pattern.test(line));
            return rule ? line.replace(rule[0], rule[1]) : line;
        })
        .join('\n')
        .replace(/^\s*\n/, '')
        .replace(/\n{3,}/g, '\n\n');
}

// A card with code shows the explanation beside the code: prose and `trace` walkthroughs (read, not typed)
// on the left, every other fenced block on the right.
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const READ_ONLY_FENCE = /^\s*trace\b/i;

/**
 * @param {string} markdown an answer as shown, possibly still streaming
 * @returns {{left:string, right:string}}
 */
function splitCodeColumn(markdown) {
    const left = [];
    const right = [];
    let fence = '';
    let target = left;
    for (const line of String(markdown || '').split('\n')) {
        const match = line.match(FENCE);
        if (match && !fence) {
            fence = match[1];
            target = READ_ONLY_FENCE.test(match[2]) ? left : right;
            target.push(line);
            continue;
        }
        if (fence) {
            target.push(line);
            if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = '';
            continue;
        }
        left.push(line);
    }
    return { left: left.join('\n').trim(), right: right.join('\n').trim() };
}

module.exports = { formatLiveAnswerText, formatAnswerForDisplay, splitCodeColumn };
