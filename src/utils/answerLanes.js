// The overlay has two screens. The main screen holds the problem the user is working through, step by
// step; side questions get their own screen so they never replace it. The answer model starts every
// reply with a "LANE:" line saying where the reply belongs, and the app strips that line before showing it.

const LANE_PREFIX = /^\s*[*_`]*\s*L(?:A(?:N(?:E(?:\s*:\s*[*_`]*\s*[A-Z]{0,4})?)?)?)?$/i;
const LANE_HEADER = /^\s*[*_`]*\s*LANE\s*:\s*[*_`]*\s*(MAIN|SIDE|NONE)\b[^\n]*(?:\n|$)/i;
// A reply that has not produced a header by this length has none; it is shown as is.
const HEADER_MAX_CHARS = 40;
// While an answer is this young, the interviewer finishing their sentence may still replace it.
const REPLACE_GRACE_MS = 5000;
const UPDATE_MARKER = /^\s*[*_]*UPDATE[*_]*\s*:\s*[*_]*\s*$/i;
// Acknowledgements such as "okay" or "mm-hmm" on their own. "Go ahead" is left out on purpose: in a
// coding round it means "start coding". Right after an answer that ends by asking the interviewer
// something, these words are an answer ("yes"), so the app passes them on (see endsWithListen).
const BACKCHANNEL =
    /^(?:(?:ok(?:ay)?|mm+[- ]?hmm+|m+hm+|uh[- ]?huh|hmm+|um+|uh+|yeah|yep|yup|yes|right|sure|cool|great|nice|perfect|alright|all right|got it|i see|sounds good|that sounds good|makes sense|that makes sense|fair enough|interesting|thanks|thank you|good|awesome|exactly|correct|understood)[\s,.!]*)+$/i;
// The last line of an answer that waits for the interviewer, such as "LISTEN: their answers".
const LISTEN_LINE = /^\s*[*_]*LISTEN\b/i;

const LANE_INSTRUCTION = `SCREEN ROUTING (the app reads the first line of every reply, so follow it exactly)
The app has two screens. The main screen holds the problem or question I'm working through, one step after another, so I never lose my place. Side questions go to a second screen.
Start every reply with exactly one of these lines, then a line break, then the answer:
LANE: MAIN for a new question or problem, and for every step that moves it forward: the interviewer answering my clarifying questions, asking me to do better or optimize, telling me to code it, or asking for a dry run.
LANE: SIDE for a counter-question, challenge, hint or detail about what's already on the main screen: why I chose something, an edge case, the complexity of one part, a trade-off. Also for a quick social question like "can you hear me?". Answer it completely, but only that point, and don't repeat the main answer.
LANE: NONE when nothing needs an answer: "okay" or "mm-hmm" that doesn't answer anything I asked, "take your time", the interviewer thinking out loud or talking to someone else, or a question cut off mid-sentence. Write nothing after that line.
If nothing is on the main screen yet, use MAIN.`;

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
 * Whether an answer ends by waiting for the interviewer (its last line is a LISTEN line), so that a
 * short "yes" or "sounds good" that follows is a reply to it, not a filler word.
 * @param {string} answer
 */
function endsWithListen(answer) {
    const lines = String(answer || '')
        .split('\n')
        .filter(line => line.trim());
    return lines.length > 0 && LISTEN_LINE.test(lines[lines.length - 1]);
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

module.exports = { LANE_INSTRUCTION, parseLaneHeader, splitSideUpdate, isReplaceableAnswer, resolveLane, isBackchannel, endsWithListen };
