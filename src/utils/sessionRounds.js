// Rounds that keep one conversation for the whole session, each written by its own prompt file: the
// DevOps incident and the experience interview. Only the "Use your API keys" session runs that
// conversation, so cloud and local can't start them. Loaded by the main process and by the start screen.
const SESSION_ROUND_SKILLS = { devops: 'devops-skill.md', experience: 'experience-skill.md' };

/** @param {string|null|undefined} profile */
function isSessionRound(profile) {
    return Object.hasOwn(SESSION_ROUND_SKILLS, profile ?? '');
}

/**
 * Why a session can't start with this profile yet, or '' when it can.
 * @param {{profile:string, name:string, providerMode:string, experienceContext?:string}} start
 */
function startBlocker({ profile, name, providerMode, experienceContext = '' }) {
    if (isSessionRound(profile) && providerMode !== 'byok') {
        return `${name} needs your own API keys. Switch to BYOK or pick another profile in AI Context.`;
    }
    // The experience round has no other source of facts about the user, so it would have to make them up.
    if (profile === 'experience' && !experienceContext.trim()) {
        return `${name} answers only from your background. Paste it under AI Customization first.`;
    }
    return '';
}

module.exports = { SESSION_ROUND_SKILLS, isSessionRound, startBlocker };
