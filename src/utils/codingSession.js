// Coding mode keeps one conversation per problem, so every turn sees the problem, the interviewer's
// answers, both pads and the code written so far. In ChatGPT the chat history did that; here the
// whole conversation is sent on each turn, oldest first, so the prompt cache keeps hitting.
const fs = require('fs');
const path = require('path');

const { getConfigDir } = require('../storage');
const { SESSION_ROUND_SKILLS } = require('./sessionRounds');

// The round picked in AI Customization decides which prompt runs the hotkey steps. Other profiles keep the DSA round.
const ROUND_SKILLS = { coding: 'dsa-coding-skill.md', lld: 'lld-skill.md', hld: 'hld-skill.md' };
const BUILT_IN_SKILL_DIR = path.join(__dirname, '..', 'prompts');

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

let loggedSkillPath = '';

/** @param {string|null|undefined} profile */
function skillFileName(profile) {
    return ROUND_SKILLS[/** @type {keyof typeof ROUND_SKILLS} */ (profile)] || ROUND_SKILLS.coding;
}

/**
 * Read on every turn, so an edited prompt applies from the next reply. A copy (or symlink) in the
 * settings folder wins, so the packaged app picks up prompt edits without a rebuild.
 * @param {string|null|undefined} profile
 */
function loadCodingSkill(profile, configDir = getConfigDir()) {
    return loadSkillFile(skillFileName(profile), configDir);
}

/**
 * A session round's own prompt (the DevOps incident, the experience interview). It's separate from the
 * round prompts above, so the coding hotkeys still run the DSA prompt in those profiles.
 * @param {keyof typeof SESSION_ROUND_SKILLS} profile
 */
function loadSessionSkill(profile, configDir = getConfigDir()) {
    return loadSkillFile(SESSION_ROUND_SKILLS[profile], configDir);
}

function loadSkillFile(name, configDir) {
    let skillPath = path.join(configDir, name);
    let text;
    try {
        text = fs.readFileSync(skillPath, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn(`Could not read ${skillPath} (${error.message}); using the built-in prompt`);
        skillPath = path.join(BUILT_IN_SKILL_DIR, name);
        text = fs.readFileSync(skillPath, 'utf8');
    }
    if (skillPath !== loggedSkillPath) console.log(`Round prompt: ${skillPath}`);
    loggedSkillPath = skillPath;
    return text;
}

/**
 * The round's prompt file in the settings folder, copied from the built-in one the first time, so the user can edit it.
 * @param {string|null|undefined} profile
 */
function ensureUserSkillFile(profile, configDir = getConfigDir()) {
    const name = SESSION_ROUND_SKILLS[/** @type {keyof typeof SESSION_ROUND_SKILLS} */ (profile)] || skillFileName(profile);
    const userPath = path.join(configDir, name);
    if (!fs.existsSync(userPath)) {
        fs.mkdirSync(configDir, { recursive: true });
        fs.copyFileSync(path.join(BUILT_IN_SKILL_DIR, name), userPath);
    }
    return userPath;
}

/** @typedef {{role:'user'|'assistant', text:string, imageJpeg?:string|null}} ChatMessage */
/** @typedef {{text:string, imageJpeg:string|null, reply:string, at:number}} CodingTurn */

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

    /**
     * Adds a turn in time order. What I said is written down a moment after I said it, so it can arrive
     * after a later question and still go before it.
     * @param {{text:string, imageJpeg?:string|null, at?:number}} turn
     */
    addTurn({ text, imageJpeg = null, at = Date.now() }) {
        /** @type {CodingTurn} */
        const turn = { text, imageJpeg, reply: '', at };
        const later = this.turns.findIndex(item => item.at > at);
        if (later === -1) this.turns.push(turn);
        else this.turns.splice(later, 0, turn);
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

module.exports = { CODING_COMMANDS, EXIT_WORDS, NEW_PROBLEM_WORDS, loadCodingSkill, loadSessionSkill, ensureUserSkillFile, CodingSession };
