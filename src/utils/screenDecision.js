// Decides whether answering a question needs what is on the user's screen right now. Jev (TypeSafe,
// through OpenRouter's Decisions API) reads the recent conversation as text and returns probabilities
// for "now", "wait" and "no" in about half a second, for about $0.00002. Text only: an image would put
// Jev in its slower, less accurate long-context mode.
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

/** @param {{recent?:string, latest:string, typed?:boolean, profile?:string|null}} input */
function buildScreenDecisionRequest({ recent = '', latest, typed = false, profile = null }) {
    const who = typed ? 'Latest line typed by the user' : 'Latest line from the other person';
    return {
        model: JEV_MODEL,
        state: `${recent.trim() ? `Earlier: ${recent.trim()}\n` : ''}${who}: ${latest}`,
        questions: { screen: profile === 'meeting' ? MEETING_SCREEN_QUESTION : SCREEN_QUESTION },
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

/** Whether the line says something is being shared, so the next question should see the screen too. */
function announcesShare(decision) {
    return decision.action === 'wait' || (decision.probabilities.wait ?? 0) >= SHARE_HINT;
}

/**
 * @param {{apiKey:string, recent?:string, latest:string, typed?:boolean, profile?:string|null, threshold:number, fetchImpl?:typeof fetch, timeoutMs?:number}} options
 * @returns {Promise<{action:'now'|'wait'|'no', probabilities:Record<string, number>, ms:number} | null>} null when Jev fails or is too slow
 */
// In the app Jev answered in 0.6 to 1.1 s on 2026-10-16, so 2 s leaves room without holding anything up:
// the answer is already running while Jev decides.
async function decideScreen({ apiKey, recent, latest, typed, profile, threshold, fetchImpl = fetch, timeoutMs = 2000 }) {
    const startedAt = Date.now();
    try {
        const response = await fetchImpl(DECISIONS_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildScreenDecisionRequest({ recent, latest, typed, profile })),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const answer = (await response.json())?.answers?.screen;
        if (!answer?.choice) return null;
        return { action: screenAction(answer, threshold), probabilities: answer.probabilities || {}, ms: Date.now() - startedAt };
    } catch {
        return null;
    }
}

module.exports = { SENSITIVITY, buildScreenDecisionRequest, screenAction, announcesShare, decideScreen };
