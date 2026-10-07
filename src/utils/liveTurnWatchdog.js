// Gemini 3.8 Live sometimes streams an answer but withholds turnComplete until interrupted.
// The watchdog finishes such a turn, so the next question starts with a fresh transcript.

class LiveTurnWatchdog {
    /** @param {{outputStallMs?:number,onStall?:Function,setTimer?:typeof setTimeout,clearTimer?:typeof clearTimeout}} options */
    constructor({ outputStallMs = 3000, onStall = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        this.outputStallMs = outputStallMs;
        this.onStall = onStall;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.stallTimer = null;
    }

    outputReceived() {
        this.clearStallTimer();
        this.stallTimer = this.setTimer(() => {
            this.stallTimer = null;
            this.onStall();
        }, this.outputStallMs);
    }

    turnEnded() {
        this.clearStallTimer();
    }

    stop() {
        this.turnEnded();
    }

    clearStallTimer() {
        this.clearTimer(this.stallTimer);
        this.stallTimer = null;
    }

    get armed() {
        return Boolean(this.stallTimer);
    }
}

module.exports = { LiveTurnWatchdog };
