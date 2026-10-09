let turnSequence = 0;

/** @typedef {{lane?:'main'|'side', label?:string, focus?:boolean}} AnswerMeta */
/** @typedef {{turnId:string,event:'start'|'update'|'complete'|'interrupted',text:string,sequence:number} & AnswerMeta} AnswerEvent */

function createTurnId(kind = 'answer') {
    turnSequence++;
    return `${kind}-${Date.now().toString(36)}-${turnSequence.toString(36)}`;
}

// Cards live in parallel arrays (text, turn id, screen, label) so the views can keep using the plain text list.
function applyAnswerEvent(state, answerEvent) {
    const responses = [...(state.responses || [])];
    const turnIds = [...(state.turnIds || [])];
    const lanes = [...(state.lanes || [])];
    const labels = [...(state.labels || [])];
    const sequences = { ...(state.sequences || {}) };
    const sequence = answerEvent.sequence ?? (sequences[answerEvent.turnId] ?? -1) + 1;
    if (sequences[answerEvent.turnId] != null && sequence <= sequences[answerEvent.turnId]) return state;

    let index = turnIds.indexOf(answerEvent.turnId);
    if (index < 0) {
        index = turnIds.length;
        turnIds.push(answerEvent.turnId);
        responses.push('');
        lanes.push(answerEvent.lane || 'main');
        labels.push(answerEvent.label || '');
    }
    responses[index] = answerEvent.text || responses[index];
    if (answerEvent.lane) lanes[index] = answerEvent.lane;
    if (answerEvent.label) labels[index] = answerEvent.label;
    sequences[answerEvent.turnId] = sequence;
    return { ...state, responses, turnIds, lanes, labels, sequences };
}

/** @param {AnswerMeta} [meta] */
function emitAnswer(send, turnId, event, text, sequence, meta = {}) {
    send('answer-event', { turnId, event, text: text || '', sequence, ...meta });
}

module.exports = { createTurnId, applyAnswerEvent, emitAnswer };
