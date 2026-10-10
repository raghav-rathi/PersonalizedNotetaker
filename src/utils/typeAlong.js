// Type-along shows the lines to type from the coding step on screen, one at a time, so the user can say
// each line's reason while typing it. The lines are every non-blank line inside the answer's fenced
// blocks: the code, and the text pads of Part 1 and Part 2. Pressing Enter in any app moves to the next.

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * @param {string} markdown an answer as shown, possibly still streaming
 * @returns {string[]} the lines to type, in order, with their indentation
 */
function typedLines(markdown) {
    const lines = [];
    let fence = '';
    for (const line of String(markdown || '').split('\n')) {
        const match = line.match(FENCE);
        if (match && !fence) {
            fence = match[1];
            continue;
        }
        if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
            fence = '';
            continue;
        }
        if (fence && line.trim()) lines.push(line.trimEnd());
    }
    return lines;
}

module.exports = { typedLines };
