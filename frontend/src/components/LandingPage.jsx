import { GoogleLogin } from '@react-oauth/google';

export default function LandingPage({ onLoginSuccess }) {
  return (
    <div className="relative h-full w-full flex items-center justify-center overflow-hidden"
      style={{ background: 'var(--bg)' }}>

      {/* ── Ambient blobs ──────────────────────────────────── */}
      <div className="blob blob-sky"
        style={{ width: 500, height: 500, top: '-10%', right: '-8%' }} />
      <div className="blob blob-violet"
        style={{ width: 380, height: 380, bottom: '-8%', left: '-6%' }} />
      <div className="blob blob-warm"
        style={{ width: 260, height: 260, top: '50%', left: '58%' }} />

      {/* ── Center card ────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center text-center px-6"
        style={{ maxWidth: 420 }}>

        {/* Eyebrow */}
        <p className="type-label animate-fade-up delay-100"
          style={{ color: 'var(--accent)', marginBottom: 24 }}>
          Voice-first AI platform
        </p>

        {/* Logo */}
        <h1 className="type-display animate-fade-up delay-200"
          style={{ fontSize: 'clamp(72px, 14vw, 108px)', marginBottom: 28 }}>
          Wo<span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>ice</span>X
        </h1>

        {/* Rule */}
        <div className="animate-wipe delay-300"
          style={{ width: 48, height: 2, background: 'var(--border-strong)', marginBottom: 24 }} />

        {/* Subtitle */}
        <p className="type-body animate-fade-up delay-400"
          style={{ marginBottom: 40, maxWidth: 300 }}>
          Your personal, voice-first<br />intelligent agent.
        </p>

        {/* Google login */}
        <div className="animate-fade-up delay-500">
          <GoogleLogin
            onSuccess={onLoginSuccess}
            onError={() => console.log('Login Failed')}
            theme="outline"
            shape="pill"
            size="large"
            text="continue_with"
          />
        </div>
      </div>

      {/* ── Bottom footnote ────────────────────────────────── */}
      <p className="type-label animate-fade-in delay-700"
        style={{
          position: 'absolute', bottom: 28,
          left: '50%', transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
        }}>
        Powered by Gemini Live
      </p>
    </div>
  );
}