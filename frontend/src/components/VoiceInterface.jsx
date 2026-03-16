import React, { useState, useEffect, useRef, useCallback } from 'react';
import ThreeOrb from './ThreeOrb';
import './VoiceInterface.css';

export default function VoiceInterface({ token, onLogout }) {
  const [status, setStatus] = useState('idle');     // idle | connecting | listening | speaking | error | disconnected
  const [sessionActive, setSession] = useState(false);
  const [transcript, setTranscript] = useState([]);         // [{role, text, id}]

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioWorkletSourceRef = useRef(null);
  const playbackContextRef = useRef(null);
  const messageQueue = useRef([]);
  const isPlaying = useRef(false);
  const transcriptEndRef = useRef(null);
  const aiBufferRef = useRef('');
  const userBufferRef = useRef('');

  // ── Scroll transcript to bottom ───────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // ── Audio helpers ─────────────────────────────────────────────────────────
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    }
    return audioContextRef.current;
  };

  const getPlaybackContext = () => {
    if (!playbackContextRef.current) {
      playbackContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    return playbackContextRef.current;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = getAudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          let binary = '';
          const bytes = new Uint8Array(pcmData.buffer);
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          wsRef.current.send(JSON.stringify({
            realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: btoa(binary) }] }
          }));
        }
      };

      source.connect(processor);
      processor.connect(context.destination);
      audioWorkletSourceRef.current = { stream, source, processor };
    } catch (err) {
      console.error('Mic error:', err);
      setStatus('error');
    }
  };

  const stopRecording = () => {
    if (audioWorkletSourceRef.current) {
      audioWorkletSourceRef.current.processor.disconnect();
      audioWorkletSourceRef.current.source.disconnect();
      audioWorkletSourceRef.current.stream.getTracks().forEach(t => t.stop());
      audioWorkletSourceRef.current = null;
    }
  };

  const playNextInQueue = useCallback(async () => {
    if (messageQueue.current.length === 0) {
      isPlaying.current = false;
      setStatus('listening');
      // Flush AI buffer to transcript
      if (aiBufferRef.current.trim()) {
        setTranscript(prev => [...prev, { role: 'ai', text: aiBufferRef.current.trim(), id: Date.now() }]);
        aiBufferRef.current = '';
      }
      return;
    }
    isPlaying.current = true;
    setStatus('speaking');

    const base64Audio = messageQueue.current.shift();
    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

    const context = getPlaybackContext();
    await context.resume();
    const buffer = context.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    source.onended = () => playNextInQueue();
  }, []);

  const queueAudio = useCallback((base64Audio) => {
    messageQueue.current.push(base64Audio);
    if (!isPlaying.current) playNextInQueue();
  }, [playNextInQueue]);

  // ── Session control ───────────────────────────────────────────────────────
  const startSession = useCallback(() => {
    setSession(true);
    setStatus('connecting');
    setTranscript([]);
    messageQueue.current = [];
    isPlaying.current = false;
    aiBufferRef.current = '';
    userBufferRef.current = '';

    const wsUrl = `ws://localhost:8000/chat/ws?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('listening');
      startRecording();
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);

        // ── Audio chunks ─────────────────────────────────────────
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) queueAudio(part.inlineData.data);
          }
        }

        // ── Finalized transcript (sent by backend for both roles) ─
        if (msg.transcript) {
          const { role, text } = msg.transcript;
          if (text) {
            setTranscript(prev => [...prev, { role, text, id: Date.now() }]);
          }
        }

        // ── Turn complete ─────────────────────────────────────────
        if (msg.turnComplete) {
          setStatus('listening');
        }
      } catch (err) {
        console.error('Failed to parse message', err);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      setSession(false);
      stopRecording();
    };
  }, [token, queueAudio]);

  const stopSession = useCallback(() => {
    stopRecording();
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
    wsRef.current = null;
    messageQueue.current = [];
    isPlaying.current = false;
    setStatus('idle');
    setSession(false);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopRecording();
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
    };
  }, []);

  // ── Status label ──────────────────────────────────────────────────────────
  const statusLabel = {
    idle: 'STANDBY',
    connecting: 'INITIALIZING',
    listening: 'LISTENING',
    speaking: 'RESPONDING',
    error: 'MIC ERROR',
    disconnected: 'DISCONNECTED',
  }[status] ?? '';

  return (
    <div className="vi-root">

      {/* ── Top bar ── */}
      <header className="vi-header">
        <div className="vi-brand">
          <span className="vi-brand-dot" />
          WoiceX
        </div>
        <button className="vi-logout" onClick={onLogout}>SIGN OUT</button>
      </header>

      {/* ── Main layout ── */}
      <main className="vi-main">

        {/* Orb column */}
        <section className="vi-orb-col">
          <div className="vi-orb-wrap">
            <ThreeOrb status={status} />
            {/* Scanline overlay */}
            <div className="vi-scanline" />
          </div>

          <div className="vi-status-row">
            <span className={`vi-status-dot vi-status-dot--${status}`} />
            <span className="vi-status-label">{statusLabel}</span>
          </div>

          {/* Session toggle */}
          <button
            className={`vi-session-btn ${sessionActive ? 'vi-session-btn--active' : ''}`}
            onClick={sessionActive ? stopSession : startSession}
          >
            {sessionActive ? (
              <>
                <span className="vi-btn-icon vi-btn-icon--stop" />
                END SESSION
              </>
            ) : (
              <>
                <span className="vi-btn-icon vi-btn-icon--start" />
                START SESSION
              </>
            )}
          </button>
        </section>

        {/* Transcript column */}
        <section className="vi-transcript-col">
          <div className="vi-transcript-header">
            <span className="vi-transcript-title">CONVERSATION LOG</span>
            {transcript.length > 0 && (
              <button className="vi-clear-btn" onClick={() => setTranscript([])}>CLEAR</button>
            )}
          </div>

          <div className="vi-transcript-body">
            {transcript.length === 0 ? (
              <div className="vi-transcript-empty">
                {sessionActive ? 'Awaiting input...' : 'Start a session to begin.'}
              </div>
            ) : (
              transcript.map((entry) => (
                <div key={entry.id} className={`vi-entry vi-entry--${entry.role}`}>
                  <span className="vi-entry-role">{entry.role === 'user' ? 'YOU' : 'AI'}</span>
                  <p className="vi-entry-text">{entry.text}</p>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>

      </main>
    </div>
  );
}