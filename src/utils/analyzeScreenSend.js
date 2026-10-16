const { CODING_ANSWER_INSTRUCTION } = require('./prompts');

function chooseAnalyzeScreenPath({ providerMode, hasApiKey, hasLiveSession, hasGroq } = {}) {
    if (providerMode === 'cloud') {
        return 'cloud';
    }
    if (providerMode === 'local') {
        return 'local';
    }
    if (hasApiKey) {
        return 'http';
    }
    if (hasLiveSession) {
        return 'live';
    }
    if (hasGroq) {
        return 'groq';
    }
    return 'none';
}

function buildLiveAnalyzeClientContent(data, prompt) {
    const text = String(prompt || '').trim() || 'Analyze this screenshot now. Give the complete answer from what you see.';
    return {
        turns: [
            {
                role: 'user',
                parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text }],
            },
        ],
        turnComplete: true,
    };
}

function sendForcedLiveScreenTurn(session, data, prompt) {
    if (!session) {
        return { success: false, error: 'No active Gemini Live session' };
    }

    try {
        if (typeof session.sendClientContent === 'function') {
            session.sendClientContent(buildLiveAnalyzeClientContent(data, prompt));
            return { success: true, mode: 'client-content' };
        }

        if (typeof session.sendRealtimeInput === 'function') {
            session.sendRealtimeInput({ video: { data, mimeType: 'image/jpeg' } });
            const text = String(prompt || '').trim();
            if (text) {
                session.sendRealtimeInput({ text });
            }
            return { success: true, mode: 'realtime' };
        }

        return { success: false, error: 'Live session cannot send a screen turn' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Gemini Flash answers only when the start-screen model is unavailable. With an OpenRouter key,
// sendImageToGeminiHttp uses the model picked on the start screen (Astra, Opus, or Sol).
const SCREEN_ANALYSIS_MODEL = 'gemini-3.8-flash';
const SCREEN_ANALYSIS_DEFAULT_REQUEST = 'Teach the logic in plain words, then give the answer for what is on this screenshot.';
const SCREEN_ANALYSIS_INSTRUCTION = `You answer what is on the user's screen during a live interview or exam. The user reads your reply in an overlay and says it out loud. Teach the logic in plain words first, then give the answer. No preamble, no acknowledgement, never reply that you understand the instructions.

Talk like an SDE-2 pairing on Zoom. Short sentences, contractions, and "because" or "so" in the same breath. Walk a tiny example. If a sentence would sound weird said to a teammate, rewrite it.

Never say "the key insight", "let's break this down", "let's dive in", "great question", "at a high level", "this is a classic", "does that make sense", "leverage", or "it's worth noting". Name a textbook term only after the plain version, if at all.

If the screenshot is a coding task, follow the coding-problem rules below.

If it is anything else (multiple choice, a concept, a website, math, or a question about me), use this shape:

**The idea**
Three to six short sentences that teach it on a tiny example, so I could explain it out loud.

**Answer**
The complete answer, concise. For multiple choice, name the option and the one reason it wins.

${CODING_ANSWER_INSTRUCTION}`;

/** @param {{data:string, request?:string, context?:string, contextChars?:number}} options */
function buildScreenAnalysisRequest({ data, request = '', context = '', contextChars = 3000 }) {
    const recent = String(context || '').trim();
    const ask = String(request || '').trim() || SCREEN_ANALYSIS_DEFAULT_REQUEST;
    const text = [recent ? `Recent conversation:\n${recent.slice(-contextChars)}` : '', `Request: ${ask}`].filter(Boolean).join('\n\n');
    return {
        model: SCREEN_ANALYSIS_MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text }] }],
        config: {
            systemInstruction: SCREEN_ANALYSIS_INSTRUCTION,
            thinkingConfig: { thinkingLevel: 'LOW' },
            maxOutputTokens: 8192,
        },
    };
}

// Gives the Live session the screen for voice follow-ups without asking it to answer (turnComplete: false).
function buildLiveScreenContextContent(data, analysisText) {
    return {
        turns: [
            {
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data } },
                    { text: `[Screen analysis shown to the user]\n${String(analysisText || '').trim()}` },
                ],
            },
        ],
        turnComplete: false,
    };
}

module.exports = {
    chooseAnalyzeScreenPath,
    buildLiveAnalyzeClientContent,
    sendForcedLiveScreenTurn,
    SCREEN_ANALYSIS_MODEL,
    SCREEN_ANALYSIS_INSTRUCTION,
    buildScreenAnalysisRequest,
    buildLiveScreenContextContent,
};
