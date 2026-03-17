import { useState, useEffect, useRef, useCallback } from 'react';
import AudioVisualizer from './AudioVisualizer';
import { GeminiClient } from './GeminiClient';
import { MediaHandler } from './MediaHandler';

const STATUS_META = {
  idle: { label: 'Standby', color: 'var(--status-idle)' },
  connecting: { label: 'Connecting', color: 'var(--status-connecting)' },
  listening: { label: 'Listening', color: 'var(--status-listening)' },
  speaking: { label: 'Responding', color: 'var(--status-speaking)' },
  error: { label: 'Error', color: 'var(--status-error)' },
  disconnected: { label: 'Offline', color: 'var(--status-idle)' },
};

export default function VoiceInterface({ token, onLogout }) {
  const [status, setStatus] = useState('idle');
  const [sessionActive, setSessionActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [agentEvents, setAgentEvents] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);

  const clientRef = useRef(null);
  const mediaRef = useRef(new MediaHandler());
  const videoRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const aiBuffer = useRef('');
  const userBuffer = useRef('');
  const keyCounter = useRef(0);
  const analyserRef = useRef(null);
  const nextKey = () => ++keyCounter.current;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const attachAnalyser = useCallback((stream, ctx) => {
    if (!stream || !ctx) return;
    const a = ctx.createAnalyser();
    a.fftSize = 256; a.smoothingTimeConstant = 0.8;
    ctx.createMediaStreamSource(stream).connect(a);
    analyserRef.current = a;
  }, []);

  const flushAI = useCallback(() => {
    const t = aiBuffer.current.trim();
    if (t) setTranscript(p => [...p, { id: nextKey(), role: 'ai', text: t }]);
    aiBuffer.current = '';
  }, []);

  const flushUser = useCallback(() => {
    const t = userBuffer.current.trim();
    if (t) setTranscript(p => [...p, { id: nextKey(), role: 'user', text: t }]);
    userBuffer.current = '';
  }, []);

  const pushEvent = useCallback((type, payload) => {
    setAgentEvents(p => [...p.slice(-49), { id: nextKey(), type, payload }]);
  }, []);

  const handleMessage = useCallback((msg) => {
    if (msg.serverContent?.modelTurn?.parts) {
      setStatus('speaking');
      for (const p of msg.serverContent.modelTurn.parts)
        if (p.inlineData?.data) mediaRef.current.playAudio(p.inlineData.data);
    }
    if (msg.transcript?.text) {
      const { role, text } = msg.transcript;
      if (role === 'user') userBuffer.current += (userBuffer.current ? ' ' : '') + text;
      else aiBuffer.current += (aiBuffer.current ? ' ' : '') + text;
    }
    if (msg.turnComplete) { flushAI(); flushUser(); setStatus('listening'); }
    if (msg.interrupted) { mediaRef.current.stopPlayback(); aiBuffer.current = ''; setStatus('listening'); }
    if (msg.agentSwitch) { setActiveAgent(msg.agentSwitch.to); pushEvent('agent_switch', msg.agentSwitch); }
    if (msg.toolEvent) pushEvent('tool_call', msg.toolEvent);
  }, [flushAI, flushUser, pushEvent]);

  const startSession = useCallback(async () => {
    setSessionActive(true); setStatus('connecting');
    setTranscript([]); setAgentEvents([]); setActiveAgent(null);
    aiBuffer.current = ''; userBuffer.current = '';

    const client = new GeminiClient({
      onOpen: async () => {
        setStatus('listening');
        try {
          const m = mediaRef.current;
          const stream = await m.startMic(buf => client.sendAudio(buf));
          attachAnalyser(stream, m.getRecordContext());
        } catch { setStatus('error'); }
      },
      onMessage: handleMessage,
      onClose: () => { setStatus('disconnected'); setSessionActive(false); analyserRef.current = null; },
      onError: () => setStatus('error'),
    });
    clientRef.current = client;
    client.connect(token);
  }, [token, handleMessage, attachAnalyser]);

  const stopSession = useCallback(() => {
    mediaRef.current.stopMic();
    clientRef.current?.disconnect();
    clientRef.current = null; analyserRef.current = null;
    aiBuffer.current = ''; userBuffer.current = '';
    setStatus('idle'); setSessionActive(false);
    if (cameraActive) { mediaRef.current.stopCamera(videoRef.current); setCameraActive(false); }
  }, [cameraActive]);

  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      mediaRef.current.stopCamera(videoRef.current); setCameraActive(false);
    } else {
      try {
        await mediaRef.current.startCamera(videoRef.current, b => clientRef.current?.sendImage(b));
        setCameraActive(true);
      } catch (e) { console.error('Camera failed:', e); }
    }
  }, [cameraActive]);

  useEffect(() => () => {
    mediaRef.current.destroy(videoRef.current);
    clientRef.current?.disconnect();
  }, []);

  const meta = STATUS_META[status] ?? STATUS_META.idle;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden"
      style={{ background: 'var(--bg)', fontFamily: 'var(--font-mono)' }}>

      {/* ── Header ────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 py-3"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>

        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative w-6 h-6 flex-shrink-0">
            <div className="absolute inset-0 rounded-full"
              style={{ border: '1px solid var(--border-mid)' }} />
            <div className="absolute rounded-full"
              style={{ inset: 5, background: 'var(--accent)' }} />
          </div>
          <span className="type-display" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>
            Wo<span style={{ color: 'var(--accent)' }}>ice</span>X
          </span>
          {activeAgent && (
            <span className="type-label px-2 py-0.5"
              style={{ border: '1px solid rgba(139,92,246,0.3)', color: 'var(--status-speaking)', background: 'rgba(139,92,246,0.06)' }}>
              {activeAgent}
            </span>
          )}
        </div>

        {/* Status + logout */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="status-dot" data-status={status} />
            <span className="type-label" style={{ color: meta.color }}>{meta.label}</span>
          </div>
          <button className="btn btn-ghost" onClick={onLogout}
            style={{ fontSize: 9, padding: '6px 12px' }}>
            Sign out
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">

        {/* ── Left: Visualizer + Controls ───────────────── */}
        <aside className="flex-shrink-0 flex flex-col items-center justify-center gap-6 px-6 py-8
                          md:w-72 border-b md:border-b-0 md:border-r"
          style={{ borderColor: 'var(--border)' }}>

          {/* Visualizer */}
          <div className="relative flex-shrink-0" style={{ width: 192, height: 192 }}>
            <div className="absolute inset-0 rounded-full"
              style={{ border: '1px solid var(--border)' }} />
            <AudioVisualizer status={status} analyserRef={analyserRef} />
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-2.5 w-full" style={{ maxWidth: 220 }}>
            <button
              className={`btn w-full ${sessionActive ? 'btn-danger' : 'btn-primary'}`}
              style={{ padding: '12px 0' }}
              onClick={sessionActive ? stopSession : startSession}
            >
              {sessionActive ? '◼ End Session' : '▶ Start Session'}
            </button>

            {sessionActive && (
              <button
                className="btn btn-outline w-full animate-slide-up"
                style={{ padding: '10px 0' }}
                onClick={toggleCamera}
              >
                {cameraActive ? '⊙ Camera On' : '○ Camera'}
              </button>
            )}
          </div>

          {/* Camera preview */}
          <video ref={videoRef} autoPlay muted playsInline
            className={`w-full rounded object-cover ${cameraActive ? 'block' : 'hidden'}`}
            style={{ maxWidth: 220, maxHeight: 110, border: '1px solid var(--border)' }} />

          {/* Agent events */}
          {agentEvents.length > 0 && (
            <div className="w-full" style={{ maxWidth: 220 }}>
              <p className="type-label mb-2">Activity</p>
              <div className="space-y-1" style={{ maxHeight: 80, overflowY: 'auto' }}>
                {agentEvents.slice(-5).map(ev => (
                  <div key={ev.id} className="flex items-center gap-2"
                    style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                    <span>{ev.type === 'tool_call' ? '⚙' : '⇢'}</span>
                    <span className="truncate">
                      {ev.type === 'tool_call' ? ev.payload.name : `${ev.payload.from} → ${ev.payload.to}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Right: Transcript ─────────────────────────── */}
        <section className="flex-1 flex flex-col overflow-hidden min-h-0"
          style={{ background: 'var(--bg-panel)' }}>

          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-3"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <span className="type-label">Conversation</span>
              {transcript.length > 0 && (
                <span className="type-label" style={{ color: 'var(--text-tertiary)' }}>
                  · {transcript.length}
                </span>
              )}
            </div>
            {transcript.length > 0 && (
              <button className="btn btn-ghost"
                style={{ fontSize: 9, padding: '4px 10px' }}
                onClick={() => { setTranscript([]); setAgentEvents([]); }}>
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 min-h-0"
            style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {transcript.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 select-none">
                <div style={{ width: 32, height: 1, background: 'var(--border-mid)' }} />
                <p className="type-label">
                  {sessionActive ? 'Listening…' : 'No messages yet'}
                </p>
                <div style={{ width: 32, height: 1, background: 'var(--border-mid)' }} />
              </div>
            ) : (
              transcript.map(entry => <Bubble key={entry.id} entry={entry} />)
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>
      </main>
    </div>
  );
}

/* ── Bubble ────────────────────────────────────────────────── */
function Bubble({ entry }) {
  const isUser = entry.role === 'user';
  return (
    <div className={`flex gap-3 items-end animate-slide-up ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
        style={{
          fontSize: 9, fontFamily: 'var(--font-mono)',
          fontWeight: 500, letterSpacing: '0.05em',
          background: isUser ? 'var(--bg-inverse)' : 'var(--bg-subtle)',
          color: isUser ? 'var(--text-inverse)' : 'var(--text-secondary)',
          border: isUser ? 'none' : '1px solid var(--border)',
          marginBottom: 2,
        }}>
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Text */}
      <div className={`px-4 py-3 ${isUser ? 'bubble-user' : 'bubble-ai'}`}
        style={{
          maxWidth: '72%',
          fontSize: 13,
          lineHeight: 1.65,
          fontFamily: 'var(--font-mono)',
          fontWeight: 300,
        }}>
        {entry.text}
      </div>
    </div>
  );
}