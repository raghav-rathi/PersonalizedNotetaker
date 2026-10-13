// Coding mode: the hotkey commands and the DSA skill that answers them. Each problem is its own
// Conversation (conversation.js), so every turn sees the problem, the interviewer's answers, both pads
// and the code written so far.
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

module.exports = { CODING_COMMANDS, EXIT_WORDS, NEW_PROBLEM_WORDS, loadCodingSkill };
