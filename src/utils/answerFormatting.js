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

module.exports = { formatLiveAnswerText };
