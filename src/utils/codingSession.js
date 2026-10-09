// Coding mode keeps one conversation per problem, so every turn sees the problem, the interviewer's
// answers, both pads and the code written so far. In ChatGPT the chat history did that; here the
// whole conversation is sent on each turn, oldest first, so the prompt cache keeps hitting.
const fs = require('fs');
const path = require('path');

const CODING_SKILL_PATH = path.join(__dirname, '..', 'prompts', 'dsa-coding-skill.md');

/** Hotkey commands, worded the way the skill expects them. */
const CODING_COMMANDS = {
    better: { text: 'command: part two', label: 'Part 2' },
    code: { text: 'command: start coding', label: 'Start coding' },
    next: { text: 'command: next step', label: 'Next step' },
    full: { text: 'command: full code', label: 'Full code' },
    dryrun: { text: 'command: dry run', label: 'Dry run' },
};

const EXIT_WORDS = /^\s*(?:exit|exit coding(?: mode)?|stop coding|end coding)\s*[.!]?\s*$/i;
// "new problem", optionally followed by the problem text the user typed or pasted.
const NEW_PROBLEM_WORDS = /^\s*new problem\b[\s:.,-]*/i;

let skillText = null;

function loadCodingSkill() {
    if (skillText === null) skillText = fs.readFileSync(CODING_SKILL_PATH, 'utf8');
    return skillText;
}

/** @typedef {{role:'user'|'assistant', text:string, imageJpeg?:string|null}} ChatMessage */
/** @typedef {{text:string, imageJpeg:string|null, reply:string}} CodingTurn */

class CodingSession {
    constructor() {
        this.active = false;
        this.problemId = 0;
        /** @type {CodingTurn[]} */
        this.turns = [];
    }

    /** Starts a new problem: earlier turns belong to the previous problem and are dropped. */
    startProblem() {
        this.active = true;
        this.problemId++;
        this.turns = [];
        return this.problemId;
    }

    stop() {
        this.active = false;
    }

    /** @param {{text:string, imageJpeg?:string|null}} turn */
    addTurn({ text, imageJpeg = null }) {
        /** @type {CodingTurn} */
        const turn = { text, imageJpeg, reply: '' };
        this.turns.push(turn);
        return turn;
    }

    /** @param {CodingTurn} turn */
    removeTurn(turn) {
        this.turns = this.turns.filter(item => item !== turn);
    }

    /**
     * The conversation up to and including `turn`. A reply that is still streaming is included as far
     * as it has got, so a counter-question asked mid-answer sees what is already on screen.
     * @param {CodingTurn} turn
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

module.exports = { CODING_COMMANDS, EXIT_WORDS, NEW_PROBLEM_WORDS, loadCodingSkill, CodingSession };
