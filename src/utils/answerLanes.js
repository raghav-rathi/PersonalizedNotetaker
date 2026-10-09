// The overlay has two screens. The main screen keeps the answer the user is reading; counter-questions
// get their own screen so they never replace it. The answer model starts every reply with a "LANE:"
// line saying where the reply belongs, and the app strips that line before showing the answer.

const LANE_PREFIX = /^\s*[*_`]*\s*L(?:A(?:N(?:E(?:\s*:\s*[*_`]*\s*[A-Z]{0,4})?)?)?)?$/i;
const LANE_HEADER = /^\s*[*_`]*\s*LANE\s*:\s*[*_`]*\s*(MAIN|SIDE|NONE)\b[^\n]*(?:\n|$)/i;
// A reply that has not produced a header by this length has none; it is shown as is.
const HEADER_MAX_CHARS = 40;
// While an answer is this young, the interviewer finishing their sentence may still replace it.
const REPLACE_GRACE_MS = 5000;
const UPDATE_MARKER = /^\s*[*_]*UPDATE[*_]*\s*:\s*[*_]*\s*$/i;
// Acknowledgements such as "okay" or "mm-hmm" on their own. "Go ahead" is left out on purpose: in a
// coding round it means "start coding".
const BACKCHANNEL =
    /^(?:(?:ok(?:ay)?|mm+[- ]?hmm+|m+hm+|uh[- ]?huh|hmm+|um+|uh+|yeah|yep|yup|yes|right|sure|cool|great|nice|perfect|alright|all right|got it|i see|sounds good|that sounds good|makes sense|that makes sense|fair enough|interesting|thanks|thank you|good|awesome|exactly|correct|understood)[\s,.!]*)+$/i;

const LANE_INSTRUCTION = `SCREEN ROUTING (the app reads the first line of every reply, so follow it exactly)
The app shows answers on two screens. The main screen holds my answer to the current main question, so I never lose my place in it. Follow-ups go to a second screen.
Start every reply with exactly one of these lines, then a line break, then the answer:
LANE: MAIN for a new question or a new topic.
LANE: SIDE for a follow-up, counter-question, challenge or interruption about the main question on screen (given below as "Main question on screen"), and for a quick social question that needs a reply, like "can you hear me?".
LANE: NONE when nothing needs an answer: "okay", "mm-hmm", "sounds good", "go on", "take your time", the interviewer thinking out loud, or a question cut off mid-sentence. Write nothing after that line.
If the main question on screen is "none yet", use MAIN.
For SIDE, answer only the new point, at the length the rules give follow-ups. Don't repeat the main answer.`;

/**
 * Reads the LANE line from a reply that is still streaming.
 * @param {string} text the reply so far
 * @returns {{status:'pending'} | {status:'done', lane:'main'|'side'|'none'|null, body:string}}
 */
function parseLaneHeader(text) {
    const raw = String(text || '');
    const match = raw.match(LANE_HEADER);
    if (match) {
        return {
            status: 'done',
            lane: /** @type {'main'|'side'|'none'} */ (match[1].toLowerCase()),
            body: raw.slice(match[0].length).replace(/^\s*\n/, ''),
        };
    }
    if ((!raw.trim() || LANE_PREFIX.test(raw)) && raw.length < HEADER_MAX_CHARS) return { status: 'pending' };
    return { status: 'done', lane: null, body: raw };
}

/**
 * Splits a counter-question answer from the changed step that follows an "UPDATE:" line.
 * The marker only counts outside code fences.
 * @param {string} body
 * @returns {{answer:string, update:string|null}}
 */
function splitSideUpdate(body) {
    const lines = String(body || '').split('\n');
    let inFence = false;
    for (let index = 0; index < lines.length; index++) {
        if (/^\s*```/.test(lines[index])) inFence = !inFence;
        else if (!inFence && UPDATE_MARKER.test(lines[index])) {
            return {
                answer: lines.slice(0, index).join('\n').trimEnd(),
                update: lines
                    .slice(index + 1)
                    .join('\n')
                    .replace(/^\s*\n/, ''),
            };
        }
    }
    return { answer: String(body || ''), update: null };
}

/**
 * A new fragment of speech may rewrite an answer only before the user has started reading it.
 * @param {{text?:string, firstTextAt?:number, now:number, graceMs?:number}} answer
 */
function isReplaceableAnswer({ text = '', firstTextAt = 0, now, graceMs = REPLACE_GRACE_MS }) {
    if (!String(text).trim()) return true;
    return Boolean(firstTextAt) && now - firstTextAt <= graceMs;
}

/** @param {string} text */
function isBackchannel(text) {
    const clean = String(text || '').trim();
    return clean.length > 0 && clean.length <= 60 && BACKCHANNEL.test(clean);
}

/**
 * A reply without a header goes to the main screen, and so does a follow-up when nothing is on it yet.
 * @param {'main'|'side'|'none'|null} requested
 * @param {{hasMainAnswer:boolean}} state
 * @returns {'main'|'side'|'none'}
 */
function resolveLane(requested, { hasMainAnswer }) {
    if (requested === 'none') return 'none';
    if (requested === 'side' && hasMainAnswer) return 'side';
    return 'main';
}

module.exports = { LANE_INSTRUCTION, parseLaneHeader, splitSideUpdate, isReplaceableAnswer, resolveLane, isBackchannel };
