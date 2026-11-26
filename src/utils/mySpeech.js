// What I say into the microphone is never answered. It's cut into utterances at my pauses, written down by
// a small Gemini model and added to the conversation as "I said: ...", so a follow-up is answered from what I
// actually said, not from a suggestion I may not have used. Without headphones the microphone also hears the
// interviewer through the speakers, so it's ignored while the interviewer's audio plays, and a transcript that
// repeats what the interviewer just said is dropped.
const { ThinkingLevel, Type } = require('@google/genai');
const { wavBuffer } = require('../audioUtils');

// The fastest model that wrote technical speech down well on 2026-11-26: 1.0 to 1.6 s for 9 to 13 s of
// speech, 25 audio tokens a second. gemini-3.8-flash took 1.9 to 2.7 s and once wrote "Qdrant" for "pgvector";
// flash-lite wrote "Gvector", which the answer model can still read.
const TRANSCRIBE_MODEL = 'gemini-3.1-flash-lite';
// Asked for plain text, flash-lite wrote "I'm not sure." for silence, hiss and clicks, even when told to write
// a marker instead. With this schema it answered speech: false for all three.
const TRANSCRIBE_PROMPT =
    'Transcribe this recording. Set speech to false when it has no clear spoken words. Otherwise set speech to true and put the spoken words, word for word with normal punctuation, in text.';
const TRANSCRIPT_SCHEMA = {
    type: Type.OBJECT,
    properties: { speech: { type: Type.BOOLEAN }, text: { type: Type.STRING } },
    required: ['speech', 'text'],
};

// A microphone frame counts as speech above this level, or three times the room's noise when that's louder.
// The browser's gain control puts normal speech well above it. The noise level drops to any quieter frame at
// once and rises 13% a second, so a noisier room raises the bar, but steady speech whose loudness the gain
// control evens out doesn't count as noise.
const MIN_SPEECH_RMS = 500;
const NOISE_FACTOR = 3;
const NOISE_RISE_PER_FRAME = 1.005;
const MIN_NOISE_RMS = 20;
// The interviewer is talking when their audio is louder than this.
const INTERVIEWER_RMS = 300;
// The two streams reach the main process up to a few hundred ms apart, and echo trails the interviewer's
// audio by the room's reverb. A microphone frame is ignored from ECHO_TAIL_MS after interviewer audio to
// ECHO_LEAD_MS before it, so each frame waits ECHO_LEAD_MS for the interviewer audio of the same moment.
const ECHO_LEAD_MS = 400;
const ECHO_TAIL_MS = 700;
const INTERVIEWER_MEMORY_MS = 10000;
// An utterance ends after this much silence. Shorter voiced sounds are clicks or coughs.
const END_SILENCE_MS = 700;
const MIN_VOICED_MS = 250;
const PRE_ROLL_MS = 300;
const TRAILING_KEEP_MS = 200;
// A long answer is cut at the first short pause after SOFT_MAX_MS, or at HARD_MAX_MS without one, so it's
// written down while I'm still talking and is ready when the next question comes.
const SOFT_MAX_MS = 15000;
const SOFT_PAUSE_MS = 250;
const HARD_MAX_MS = 25000;
// A transcript is echo when this share of its word pairs is in what the interviewer just said.
const ECHO_SHARE = 0.6;

/** Root mean square of 16-bit little-endian PCM. @param {Buffer} pcm */
function pcmRms(pcm) {
    const samples = Math.floor(pcm.length / 2);
    if (!samples) return 0;
    let sum = 0;
    for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
        const value = pcm.readInt16LE(offset);
        sum += value * value;
    }
    return Math.sqrt(sum / samples);
}

/** @typedef {{pcm: Buffer, start: number, end: number, ms: number, rms: number}} MicFrame */
/** @typedef {{pcm: Buffer, sampleRate: number, startAt: number, endAt: number}} Utterance */

class SpeechSegmenter {
    /** @param {{onUtterance: (utterance: Utterance) => void}} options */
    constructor({ onUtterance }) {
        this.onUtterance = onUtterance;
        this.sampleRate = 16000;
        /** @type {MicFrame[]} frames waiting for the interviewer audio of the same moment */
        this.waiting = [];
        /** @type {{start: number, end: number}[]} */
        this.interviewer = [];
        this.noiseRms = MIN_NOISE_RMS;
        /** @type {MicFrame[]} */
        this.preRoll = [];
        /** @type {{frames: MicFrame[], voicedMs: number, silenceMs: number} | null} */
        this.utterance = null;
    }

    /** @param {Buffer} pcm @param {number} sampleRate @param {number} at arrival time in ms */
    pushMic(pcm, sampleRate, at) {
        if (sampleRate !== this.sampleRate) {
            this.flush();
            this.sampleRate = sampleRate;
        }
        const ms = (pcm.length / 2 / sampleRate) * 1000;
        this.waiting.push({ pcm, start: at - ms, end: at, ms, rms: pcmRms(pcm) });
        while (this.waiting.length && this.waiting[0].end <= at - ECHO_LEAD_MS) this.step(this.waiting.shift());
    }

    /** @param {Buffer} pcm @param {number} sampleRate @param {number} at arrival time in ms */
    noteInterviewer(pcm, sampleRate, at) {
        if (pcmRms(pcm) < INTERVIEWER_RMS) return;
        const start = at - (pcm.length / 2 / sampleRate) * 1000;
        const last = this.interviewer[this.interviewer.length - 1];
        if (last && start - last.end <= 50) last.end = Math.max(last.end, at);
        else this.interviewer.push({ start, end: at });
        while (this.interviewer.length && this.interviewer[0].end < at - INTERVIEWER_MEMORY_MS) this.interviewer.shift();
    }

    /** Ends what I'm saying now, for a question that's about to be answered. */
    flush() {
        while (this.waiting.length) this.step(this.waiting.shift());
        this.endUtterance();
    }

    /** @param {MicFrame} frame */
    interviewerNear(frame) {
        const from = frame.start - ECHO_TAIL_MS;
        const to = frame.end + ECHO_LEAD_MS;
        return this.interviewer.some(span => span.end >= from && span.start <= to);
    }

    /** @param {MicFrame} frame */
    isSpeech(frame) {
        this.noiseRms = Math.max(MIN_NOISE_RMS, Math.min(frame.rms, this.noiseRms * NOISE_RISE_PER_FRAME));
        return frame.rms >= Math.max(MIN_SPEECH_RMS, this.noiseRms * NOISE_FACTOR);
    }

    /** @param {MicFrame} frame */
    step(frame) {
        // While the interviewer talks, the microphone hears them, or my turn is over.
        if (this.interviewerNear(frame)) {
            this.endUtterance();
            this.preRoll = [];
            return;
        }
        const speech = this.isSpeech(frame);
        const utterance = this.utterance;
        if (!utterance) {
            if (speech) {
                this.utterance = { frames: [...this.preRoll, frame], voicedMs: frame.ms, silenceMs: 0 };
                this.preRoll = [];
                return;
            }
            this.preRoll.push(frame);
            while (this.preRoll.length > 1 && this.preRoll[this.preRoll.length - 1].end - this.preRoll[1].start > PRE_ROLL_MS) this.preRoll.shift();
            return;
        }
        utterance.frames.push(frame);
        if (speech) {
            utterance.voicedMs += frame.ms;
            utterance.silenceMs = 0;
        } else utterance.silenceMs += frame.ms;
        const lengthMs = frame.end - utterance.frames[0].start;
        if (utterance.silenceMs >= END_SILENCE_MS || (lengthMs >= SOFT_MAX_MS && utterance.silenceMs >= SOFT_PAUSE_MS) || lengthMs >= HARD_MAX_MS) {
            this.endUtterance();
        }
    }

    endUtterance() {
        const utterance = this.utterance;
        this.utterance = null;
        if (!utterance || utterance.voicedMs < MIN_VOICED_MS) return;
        // Keep a little of the trailing silence so the last word isn't cut.
        let kept = utterance.frames.length;
        let trailingMs = utterance.silenceMs;
        while (kept > 1 && trailingMs - utterance.frames[kept - 1].ms >= TRAILING_KEEP_MS) {
            trailingMs -= utterance.frames[kept - 1].ms;
            kept--;
        }
        const frames = utterance.frames.slice(0, kept);
        this.onUtterance({
            pcm: Buffer.concat(frames.map(frame => frame.pcm)),
            sampleRate: this.sampleRate,
            startAt: frames[0].start,
            endAt: frames[frames.length - 1].end,
        });
    }
}

/** @param {string} text */
function words(text) {
    return (
        String(text || '')
            .toLowerCase()
            .match(/[a-z0-9']+/g) || []
    );
}

/** @param {string[]} list */
function wordPairs(list) {
    return list.slice(1).map((word, index) => `${list[index]} ${word}`);
}

/**
 * True when the microphone wrote down what the interviewer just said, heard through the speakers.
 * @param {string} said @param {string} heard what the interviewer said around the same time
 */
function isEcho(said, heard) {
    const mine = words(said);
    const theirs = words(heard);
    if (!mine.length || !theirs.length) return false;
    if (mine.length < 4) {
        const theirWords = new Set(theirs);
        return mine.filter(word => theirWords.has(word)).length / mine.length >= ECHO_SHARE;
    }
    const theirPairs = new Set(wordPairs(theirs));
    const myPairs = wordPairs(mine);
    return myPairs.filter(pair => theirPairs.has(pair)).length / myPairs.length >= ECHO_SHARE;
}

/** @param {string|undefined} raw @returns {string} */
function parseTranscript(raw) {
    try {
        const { speech, text } = JSON.parse(raw || '{}');
        return speech === true && typeof text === 'string' ? text.trim() : '';
    } catch {
        return '';
    }
}

/**
 * Writes down one utterance; '' when it has no clear words.
 * @param {{client: {models: {generateContent: Function}}, pcm: Buffer, sampleRate: number}} request
 */
async function transcribeUtterance({ client, pcm, sampleRate }) {
    const result = await client.models.generateContent({
        model: TRANSCRIBE_MODEL,
        contents: [
            {
                role: 'user',
                parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBuffer(pcm, sampleRate).toString('base64') } }, { text: TRANSCRIBE_PROMPT }],
            },
        ],
        config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            temperature: 0,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: TRANSCRIPT_SCHEMA,
        },
    });
    return parseTranscript(result.text);
}

// Added to every answer's instructions while my microphone is heard.
const MY_SPEECH_INSTRUCTION = `WHAT I ACTUALLY SAID
My microphone is on. "I said: ..." is what I said out loud, written down from my microphone. It can have transcription mistakes, so read it for meaning.
- Your earlier replies were suggestions. The interviewer heard what I said, not your suggestion. When they differ, what I said is what happened.
- A follow-up is about what I said. If I talked about a different project, example or approach than you suggested, answer about the one I talked about. Don't bring your suggestion back.
- Stay consistent with what I said. Don't contradict it, and don't repeat what I already said. Pick up from where I stopped.
- What I said about myself counts as a fact about me for the rest of the interview.
- Never reply to "I said:" on its own. It's context for the next question.`;

module.exports = { SpeechSegmenter, isEcho, parseTranscript, transcribeUtterance, pcmRms, MY_SPEECH_INSTRUCTION, TRANSCRIBE_MODEL };
