/**
 * GeminiClient
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin WebSocket wrapper that mirrors the Google Gemini Live SDK pattern.
 * Responsible only for transport — no media, no state.
 *
 * Outbound message shapes:
 *   • PCM audio   →  { realtimeInput: { mediaChunks: [{ mimeType, data }] } }
 *   • JPEG frame  →  { realtimeInput: { mediaChunks: [{ mimeType, data }] } }
 *   • Text turn   →  { text: "..." }
 *
 * Inbound message shapes (JSON from backend):
 *   • Audio chunk     →  { serverContent: { modelTurn: { parts: [{ inlineData }] } } }
 *   • Transcript      →  { transcript: { role: "user"|"ai", text } }
 *   • Turn complete   →  { turnComplete: true }
 *   • Tool event      →  { toolEvent: { name, args, result } }
 *   • Agent switch    →  { agentSwitch: { from, to } }
 *   • Interrupted     →  { interrupted: true }
 */
export class GeminiClient {
    constructor({ onOpen, onAudio, onMessage, onClose, onError } = {}) {
        this.ws = null;
        this.handlers = { onOpen, onAudio, onMessage, onClose, onError };
    }

    connect(token) {
        const url = `ws://localhost:8000/chat/ws?token=${token}`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => this.handlers.onOpen?.();

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                // Raw binary audio (future path — currently backend sends base64 in JSON)
                this.handlers.onAudio?.(event.data);
            } else {
                try {
                    const msg = JSON.parse(event.data);
                    this.handlers.onMessage?.(msg);
                } catch (e) {
                    console.error('[GeminiClient] parse error:', e);
                }
            }
        };

        this.ws.onclose = (e) => this.handlers.onClose?.(e);
        this.ws.onerror = (e) => this.handlers.onError?.(e);
    }

    /** Send raw PCM Int16 ArrayBuffer */
    sendAudio(pcmBuffer) {
        if (!this.isOpen()) return;
        const bytes = new Uint8Array(pcmBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        this._sendJSON({
            realtimeInput: {
                mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: btoa(binary) }],
            },
        });
    }

    /** Send a JPEG frame as base64 string */
    sendImage(base64Data) {
        if (!this.isOpen()) return;
        this._sendJSON({
            realtimeInput: {
                mediaChunks: [{ mimeType: 'image/jpeg', data: base64Data }],
            },
        });
    }

    /** Send a text message turn */
    sendText(text) {
        if (!this.isOpen()) return;
        this._sendJSON({ text });
    }

    disconnect() {
        this.ws?.close();
        this.ws = null;
    }

    isOpen() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    _sendJSON(payload) {
        this.ws.send(JSON.stringify(payload));
    }
}