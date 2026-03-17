/**
 * MediaHandler
 * Manages microphone capture (via AudioWorkletNode), camera capture,
 * and scheduled gapless audio playback.
 */
export class MediaHandler {
    constructor() {
        // Recording
        this.recordContext = null;
        this.micStream = null;
        this.workletNode = null;
        this.isRecording = false;

        // Camera
        this.cameraStream = null;
        this.cameraInterval = null;
        this._canvas = document.createElement('canvas');
        this._canvas.width = 640;
        this._canvas.height = 480;
        this._ctx = this._canvas.getContext('2d');

        // Playback — gapless scheduled queue
        this.playbackCtx = null;
        this.nextStartTime = 0;
        this.scheduledSources = [];
    }

    // ─── Microphone ─────────────────────────────────────────────────────────────

    async startMic(onPcmData) {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        this.recordContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000,
        });
        await this.recordContext.resume();

        // Load the worklet processor from /public
        await this.recordContext.audioWorklet.addModule('/pcm-processor.js');

        const source = this.recordContext.createMediaStreamSource(this.micStream);
        this.workletNode = new AudioWorkletNode(this.recordContext, 'pcm-processor');

        this.workletNode.port.onmessage = (e) => {
            if (!this.isRecording) return;
            const float32 = e.data; // Float32Array, 4096 samples @ 16kHz
            const pcm16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            onPcmData(pcm16.buffer);
        };

        source.connect(this.workletNode);
        // Mute local output to prevent echo — worklet must be connected to
        // destination or it won't process, so connect through a silent gain node
        const mute = this.recordContext.createGain();
        mute.gain.value = 0;
        this.workletNode.connect(mute);
        mute.connect(this.recordContext.destination);

        this.isRecording = true;
        return this.micStream; // expose for AnalyserNode in visualizer
    }

    stopMic() {
        this.isRecording = false;
        this.workletNode?.disconnect();
        this.workletNode = null;
        this.micStream?.getTracks().forEach((t) => t.stop());
        this.micStream = null;
        this.recordContext?.close().catch(() => { });
        this.recordContext = null;
    }

    getMicStream() {
        return this.micStream;
    }

    getRecordContext() {
        return this.recordContext;
    }

    // ─── Camera ─────────────────────────────────────────────────────────────────

    async startCamera(videoEl, onFrame) {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoEl.srcObject = this.cameraStream;
        await videoEl.play();
        this.cameraInterval = setInterval(() => this._captureFrame(videoEl, onFrame), 1000);
    }

    stopCamera(videoEl) {
        clearInterval(this.cameraInterval);
        this.cameraInterval = null;
        this.cameraStream?.getTracks().forEach((t) => t.stop());
        this.cameraStream = null;
        if (videoEl) videoEl.srcObject = null;
    }

    isCameraActive() {
        return !!this.cameraStream;
    }

    _captureFrame(videoEl, onFrame) {
        if (!this.cameraStream || videoEl.readyState < 2) return;
        this._ctx.drawImage(videoEl, 0, 0, 640, 480);
        const base64 = this._canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        onFrame(base64);
    }

    // ─── Playback ────────────────────────────────────────────────────────────────

    _ensurePlayback() {
        if (!this.playbackCtx) {
            this.playbackCtx = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000,
            });
        }
        if (this.playbackCtx.state === 'suspended') this.playbackCtx.resume();
        return this.playbackCtx;
    }

    playAudio(base64Data) {
        const ctx = this._ensurePlayback();

        const bin = atob(base64Data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

        const buffer = ctx.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        this.nextStartTime = Math.max(now, this.nextStartTime);
        source.start(this.nextStartTime);
        this.nextStartTime += buffer.duration;

        this.scheduledSources.push(source);
        source.onended = () => {
            const i = this.scheduledSources.indexOf(source);
            if (i > -1) this.scheduledSources.splice(i, 1);
        };
    }

    stopPlayback() {
        this.scheduledSources.forEach((s) => { try { s.stop(); } catch (_) { } });
        this.scheduledSources = [];
        if (this.playbackCtx) this.nextStartTime = this.playbackCtx.currentTime;
    }

    destroy(videoEl) {
        this.stopMic();
        this.stopCamera(videoEl);
        this.stopPlayback();
        this.playbackCtx?.close().catch(() => { });
        this.playbackCtx = null;
    }
}