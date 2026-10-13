// A chat with the answer model, kept the way ChatGPT keeps one: every message and reply so far goes
// with each new message, oldest first. The model sees the whole discussion (the problem, its own
// questions, the interviewer's answers, the approach so far), and since the start never changes,
// the prompt cache keeps hitting. Interview answers use one conversation per session, and coding
// mode uses one per problem.

/** @typedef {{role:'user'|'assistant', text:string, imageJpeg?:string|null}} ChatMessage */
/** @typedef {{text:string, imageJpeg:string|null, reply:string}} ConversationTurn */

class Conversation {
    constructor() {
        /** @type {ConversationTurn[]} */
        this.turns = [];
    }

    clear() {
        this.turns = [];
    }

    /** @param {{text:string, imageJpeg?:string|null}} turn */
    addTurn({ text, imageJpeg = null }) {
        /** @type {ConversationTurn} */
        const turn = { text, imageJpeg, reply: '' };
        this.turns.push(turn);
        return turn;
    }

    /** @param {ConversationTurn} turn */
    removeTurn(turn) {
        this.turns = this.turns.filter(item => item !== turn);
    }

    /**
     * The conversation up to and including `turn`. A reply that is still streaming is included as far
     * as it has got, so a question asked mid-answer sees what is already on screen.
     * @param {ConversationTurn} turn
     * @returns {ChatMessage[]}
     */
    messagesThrough(turn) {
        /** @type {ChatMessage[]} */
        const messages = [];
        for (const item of this.turns) {
            messages.push({ role: 'user', text: item.text, imageJpeg: item.imageJpeg });
            if (item === turn) break;
            if (item.reply.trim()) messages.push({ role: 'assistant', text: item.reply });
        }
        return messages;
    }
}

module.exports = { Conversation };
