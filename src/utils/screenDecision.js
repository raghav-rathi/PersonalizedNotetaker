// Decides whether answering a question needs what is on the user's screen right now. Jev (TypeSafe,
// through OpenRouter's Decisions API) reads the recent conversation as text and returns probabilities
// for "now", "wait" and "no" in about half a second, for about $0.00002. Text only: an image would put
// Jev in its slower, less accurate long-context mode.
// The same call also decides how hard the answer model thinks (DEPTH_QUESTION); on 2026-10-17 it sorted
// 16 of 16 interview lines right and added about 12 ms.
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.14';
// How sure Jev must be that the screen is needed, per the Settings choice.
const SENSITIVITY = { more: 0.3, balanced: 0.5, fewer: 0.7 };
// A line that announces sharing ("I'm sharing my Kibana dashboard now") can score highest on "now", yet still
// gives "wait" at least this much; plain questions gave at most 0.09 on 2026-10-16.
const SHARE_HINT = 0.2;

const SCREEN_QUESTION = {
    type: 'choice',
    instructions:
        "The user is in a live interview or meeting and reads answers from an overlay. Decide whether answering the latest line needs a screenshot of the user's screen.",
    criteria: {
        now: 'The latest line refers to something visible on screen right now: "this", "here", code, a line number, an error, a document, a dashboard or something just shared or opened.',
        wait: 'The speaker is about to share or open something, or asks the user to open it, and the real question will come after it appears. No answer is needed yet.',
        no: 'The line can be answered from knowledge and the conversation alone, without looking at the screen.',
    },
};

// A meeting shares a screen most of the time, so there the screen is attached only when the answer has to
// point at something on it; sharing it, or asking whether people can see it, is not enough.
const MEETING_SCREEN_QUESTION = {
    type: 'choice',
    instructions:
        'The user is in a live team meeting and reads answers from an overlay. Decide whether answering the latest line needs a screenshot of the screen being shared.',
    criteria: {
        now: 'The latest line asks about something specific that is visible on the shared screen right now, and a good answer has to quote or point at it: a log line, a value, an error, a dashboard field, a table row or a line of code ("this", "here", "on this line", "in this row").',
        no: 'The line can be answered from knowledge, the meeting context and the conversation, even if a screen is being shared. Questions about what a ticket, change or release did, why something was done, or which query to run are no unless they point at something on screen. Announcing a share or checking it ("I\'m sharing Splunk", "can you see my screen?") is no.',
    },
};

const DEPTH_QUESTION = {
    type: 'choice',
    instructions:
        'The user is in a live interview and reads answers from an overlay. Decide whether the answer to the latest line can be written at once, or needs the model to think it through first.',
    criteria: {
        quick: 'Small talk, a behavioral or experience question, a definition, a clarification, or a follow-up about an approach already explained (its complexity, why a data structure was chosen, what a line does).',
        think: 'A new coding, DSA or design problem; writing, fixing or optimizing code; a dry run, a tricky edge case or a changed constraint (much larger input, negatives, duplicates); or the interviewer says the earlier answer is wrong, has a bug, fails a case or can be better.',
    },
};

/** @param {{recent?:string, latest:string, typed?:boolean, profile?:string|null}} input */
function buildScreenDecisionRequest({ recent = '', latest, typed = false, profile = null }) {
    const who = typed ? 'Latest line typed by the user' : 'Latest line from the other person';
    return {
        model: JEV_MODEL,
        state: `${recent.trim() ? `Earlier: ${recent.trim()}\n` : ''}${who}: ${latest}`,
        questions: { screen: profile === 'meeting' ? MEETING_SCREEN_QUESTION : SCREEN_QUESTION, depth: DEPTH_QUESTION },
    };
}

/**
 * @param {{choice?:string, probabilities?:Record<string, number>}} answer
 * @param {number} threshold
 * @returns {'now'|'wait'|'no'}
 */
function screenAction(answer, threshold) {
    if ((answer.probabilities?.now ?? (answer.choice === 'now' ? 1 : 0)) >= threshold) return 'now';
    return answer.choice === 'wait' ? 'wait' : 'no';
}

/**
 * A missing or failed depth answer thinks, as every answer did before Jev chose.
 * @param {{choice?:string, probabilities?:Record<string, number>}|undefined} answer
 * @returns {'quick'|'think'}
 */
function answerDepth(answer) {
    const think = answer?.probabilities?.think;
    if (think !== undefined) return think >= 0.5 ? 'think' : 'quick';
    return answer?.choice === 'quick' ? 'quick' : 'think';
}

/** Whether the line says something is being shared, so the next question should see the screen too. */
function announcesShare(decision) {
    return decision.action === 'wait' || (decision.probabilities.wait ?? 0) >= SHARE_HINT;
}

/**
 * @param {{apiKey:string, recent?:string, latest:string, typed?:boolean, profile?:string|null, threshold:number, fetchImpl?:typeof fetch, timeoutMs?:number, signal?:AbortSignal}} options
 * @returns {Promise<{action:'now'|'wait'|'no', probabilities:Record<string, number>, depth:'quick'|'think', thinkProbability:number|null, ms:number} | null>} null when Jev fails, is too slow or is aborted
 */
// In the app Jev answered in 0.6 to 1.1 s on 2026-10-16, so 2 s leaves room without holding anything up:
// the answer is already running while Jev decides.
async function decideScreen({ apiKey, recent, latest, typed, profile, threshold, fetchImpl = fetch, timeoutMs = 2000, signal }) {
    const startedAt = Date.now();
    try {
        const response = await fetchImpl(DECISIONS_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildScreenDecisionRequest({ recent, latest, typed, profile })),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const answers = (await response.json())?.answers;
        const answer = answers?.screen;
        if (!answer?.choice) return null;
        return {
            action: screenAction(answer, threshold),
            probabilities: answer.probabilities || {},
            depth: answerDepth(answers.depth),
            thinkProbability: answers.depth?.probabilities?.think ?? null,
            ms: Date.now() - startedAt,
        };
    } catch {
        return null;
    }
}

module.exports = { SENSITIVITY, buildScreenDecisionRequest, screenAction, answerDepth, announcesShare, decideScreen };
