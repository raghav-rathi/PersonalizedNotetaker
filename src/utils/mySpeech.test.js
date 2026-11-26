const test = require('node:test');
const assert = require('node:assert/strict');

const { SpeechSegmenter, isEcho, parseTranscript } = require('./mySpeech');

const RATE = 16000;
const FRAME_MS = 40;

/** 40 ms of 16 kHz PCM at roughly this RMS level. */
function frame(level, sampleRate = RATE, ms = FRAME_MS) {
    const pcm = Buffer.alloc(((sampleRate * ms) / 1000) * 2);
    for (let index = 0; index < pcm.length / 2; index++) pcm.writeInt16LE(index % 2 ? level : -level, index * 2);
    return pcm;
}

/**
 * Plays a timeline: the microphone level at each 40 ms, and when the interviewer's audio is playing.
 * @param {(at: number) => number} micLevel @param {(at: number) => boolean} interviewerTalking
 */
function play(micLevel, interviewerTalking, untilMs) {
    const utterances = [];
    const segmenter = new SpeechSegmenter({ onUtterance: utterance => utterances.push(utterance) });
    const events = [];
    for (let at = FRAME_MS; at <= untilMs; at += FRAME_MS) events.push({ at, mic: micLevel(at) });
    for (let at = 100; at <= untilMs; at += 100) if (interviewerTalking(at)) events.push({ at, interviewer: true });
    events.sort((a, b) => a.at - b.at);
    for (const event of events) {
        if (event.interviewer) segmenter.noteInterviewer(frame(3000, 24000, 100), 24000, event.at);
        else segmenter.pushMic(frame(event.mic), RATE, event.at);
    }
    segmenter.flush();
    return utterances.map(({ startAt, endAt, pcm }) => ({ startAt, endAt, ms: (pcm.length / 2 / RATE) * 1000 }));
}

const QUIET = 20;
const VOICE = 3000;
const never = () => false;

test('speech between pauses becomes one utterance, and a click is not speech', () => {
    const [utterance, ...rest] = play(at => (at > 1000 && at <= 3000 ? VOICE : QUIET), never, 5000);
    assert.equal(rest.length, 0);
    // The 2 s of speech, with a little silence kept on each side.
    assert.ok(utterance.ms >= 2000 && utterance.ms <= 2600, `utterance was ${utterance.ms} ms`);
    assert.ok(utterance.startAt >= 650 && utterance.startAt <= 1000);

    assert.deepEqual(
        play(at => (at > 1000 && at <= 1080 ? VOICE : QUIET), never, 3000),
        [],
        'an 80 ms click is not speech'
    );
});

test('the microphone is ignored while the interviewer talks, and their audio ends my turn', () => {
    // I talk until 2.5 s; then the interviewer talks until 4.5 s and the microphone hears them, quieter.
    const micLevel = at => (at > 1000 && at <= 2500 ? VOICE : at > 2500 && at <= 4500 ? 1500 : QUIET);
    const interviewerTalking = at => at > 2500 && at <= 4500;
    const utterances = play(micLevel, interviewerTalking, 7000);
    assert.equal(utterances.length, 1, 'their voice in my microphone is not my speech');
    assert.ok(utterances[0].endAt <= 2500, 'my utterance ends when their audio starts');
    assert.ok(utterances[0].ms >= 900, `kept ${utterances[0].ms} ms of my speech`);

    // My speech after they stop, past the echo tail, is heard again.
    const after = play(at => (at > 6000 && at <= 7500 ? VOICE : micLevel(at)), interviewerTalking, 9000);
    assert.equal(after.length, 2);
    assert.ok(after[1].startAt >= 5200);
});

test('a long answer is cut at a short pause after 15 seconds, so it is written down while I keep talking', () => {
    const micLevel = at => {
        if (at <= 1000 || at > 20500) return QUIET;
        if (at > 16000 && at <= 16320) return QUIET; // a short pause between sentences
        return VOICE;
    };
    const utterances = play(micLevel, never, 22000);
    assert.equal(utterances.length, 2);
    assert.ok(utterances[0].endAt > 16000 && utterances[0].endAt <= 16400, `first part ended at ${utterances[0].endAt}`);
    assert.ok(utterances[1].ms >= 4000);
});

test('echo of the interviewer is recognised, and my own answer is not', () => {
    const question = 'So how does Kafka keep messages in order across partitions?';
    assert.equal(isEcho('How does Kafka keep messages in order', question), true);
    assert.equal(isEcho('Kafka only keeps order inside one partition, so I keyed every event by shipment ID.', question), false);
    // Repeating the question before answering it is still my answer.
    assert.equal(isEcho('How does Kafka keep order? Well, it only promises order inside a partition, so the key decides it.', question), false);
    assert.equal(isEcho('Yeah, sure.', ''), false);
});

test('a transcript counts only when the model says there was speech', () => {
    assert.equal(parseTranscript('{"speech": true, "text": " I ported the model. "}'), 'I ported the model.');
    assert.equal(parseTranscript('{"speech": false, "text": "I\'m not sure."}'), '');
    assert.equal(parseTranscript('not json'), '');
    assert.equal(parseTranscript(undefined), '');
});
