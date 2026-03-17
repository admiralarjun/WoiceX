/**
 * pcm-processor.js
 * Place this file in your /public folder so it's served as a static asset.
 * MediaHandler loads it via: audioContext.audioWorklet.addModule('/pcm-processor.js')
 */
class PcmProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(4096);
        this._offset = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channel = input[0];

        for (let i = 0; i < channel.length; i++) {
            this._buffer[this._offset++] = channel[i];

            if (this._offset >= this._buffer.length) {
                // Copy before posting — don't transfer, we reuse the buffer
                this.port.postMessage(this._buffer.slice());
                this._offset = 0;
            }
        }

        return true;
    }
}

registerProcessor('pcm-processor', PcmProcessor);