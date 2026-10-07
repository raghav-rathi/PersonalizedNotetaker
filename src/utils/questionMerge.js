// Interviewers pause mid-question, and Gemini Live then splits the speech into separate turns.
// A transcript that arrives within the merge window is treated as part of the same question, so the
// combined text is answered again in the same card instead of each fragment getting its own answer.
const QUESTION_MERGE_WINDOW_MS = 12000;

/** @typedef {{prefix:string,fragment:string,turnSeq:number,turnId:string,at:number}} VoiceQuestion */

/**
 * @param {VoiceQuestion|null} previous
 * @param {{fragment:string,turnSeq:number,now:number,newTurnId:() => string,windowMs?:number}} next
 * @returns {VoiceQuestion}
 */
function nextVoiceQuestion(previous, { fragment, turnSeq, now, newTurnId, windowMs = QUESTION_MERGE_WINDOW_MS }) {
    if (previous && now - previous.at <= windowMs) {
        // A grown transcript of the same Live turn replaces that fragment; a new turn is appended.
        const prefix = previous.turnSeq === turnSeq ? previous.prefix : questionText(previous);
        return { prefix, fragment, turnSeq, turnId: previous.turnId, at: now };
    }
    return { prefix: '', fragment, turnSeq, turnId: newTurnId(), at: now };
}

/** @param {VoiceQuestion} question */
function questionText(question) {
    return [question.prefix, question.fragment].filter(Boolean).join(' ');
}

module.exports = { QUESTION_MERGE_WINDOW_MS, nextVoiceQuestion, questionText };
