import { useEffect, useRef } from 'react';

/**
 * AudioVisualizer
 * Three concentric radial rings that react to mic audio.
 *
 * Props:
 *   status       — 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'
 *   analyserRef  — React ref whose .current is a Web Audio AnalyserNode | null
 *
 * The RAF loop runs ONCE for the component lifetime (empty dep array).
 * status is kept in a ref so palette changes take effect immediately
 * without restarting the loop.
 */
export default function AudioVisualizer({ status, analyserRef }) {
    const canvasRef = useRef(null);
    const rafRef = useRef(null);
    const phaseRef = useRef(0);
    const statusRef = useRef(status);

    // Keep status ref in sync with prop
    statusRef.current = status;
    // analyserRef is passed in from parent — .current is always live

    // ── One-time RAF loop setup ───────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;

        const resize = () => {
            const size = canvas.offsetWidth;
            if (size === 0) return;
            canvas.width = size * dpr;
            canvas.height = size * dpr;
        };
        resize();
        window.addEventListener('resize', resize);

        const PALETTES = {
            idle: { primary: '#a8a29e', accent: '#d6d3d1', glow: 'rgba(168,162,158,0.10)' },
            connecting: { primary: '#d97706', accent: '#fbbf24', glow: 'rgba(217,119,6,0.15)' },
            listening: { primary: '#0284c7', accent: '#38bdf8', glow: 'rgba(2,132,199,0.18)' },
            speaking: { primary: '#7c3aed', accent: '#a78bfa', glow: 'rgba(124,58,237,0.20)' },
            error: { primary: '#dc2626', accent: '#f87171', glow: 'rgba(220,38,38,0.15)' },
            disconnected: { primary: '#d6d3d1', accent: '#e7e5e4', glow: 'rgba(214,211,209,0.08)' },
        };

        const RINGS = [
            { radiusFactor: 0.28, bandStart: 0, bandEnd: 8, lineWidth: 1.5, points: 120 },
            { radiusFactor: 0.38, bandStart: 8, bandEnd: 32, lineWidth: 1.2, points: 160 },
            { radiusFactor: 0.48, bandStart: 32, bandEnd: 64, lineWidth: 0.9, points: 200 },
        ];

        const fftSize = 256;
        const dataArray = new Uint8Array(fftSize / 2);

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            phaseRef.current += 0.012;

            const W = canvas.width;
            const H = canvas.height;
            const cx = W / 2;
            const cy = H / 2;

            const currentStatus = statusRef.current;
            const currentAnalyser = analyserRef.current;

            const palette = PALETTES[currentStatus] ?? PALETTES.idle;
            const ctx = canvas.getContext('2d');

            ctx.clearRect(0, 0, W, H);

            // Glow disc
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.26);
            grad.addColorStop(0, palette.glow);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, W * 0.26, 0, Math.PI * 2);
            ctx.fill();

            // Frequency data
            if (currentAnalyser) {
                currentAnalyser.fftSize = fftSize;
                currentAnalyser.getByteFrequencyData(dataArray);
            } else {
                const amp = currentStatus === 'idle' ? 8 : 18;
                const spd = currentStatus === 'idle' ? 1 : 1.5;
                for (let i = 0; i < dataArray.length; i++) {
                    dataArray[i] = Math.sin(phaseRef.current * spd + i * 0.3) * amp + amp;
                }
            }

            RINGS.forEach((ring, ri) => {
                const { radiusFactor, bandStart, bandEnd, lineWidth, points } = ring;
                const radius = (W / 2) * radiusFactor;

                // Band energy
                let energy = 0;
                for (let i = bandStart; i < bandEnd; i++) energy += dataArray[i];
                energy /= (bandEnd - bandStart) * 255;

                const amplitude = currentAnalyser
                    ? energy * radius * 0.55
                    : (Math.sin(phaseRef.current + ri * 1.1) * 0.04 + 0.04) * radius;

                const ringGrad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
                ringGrad.addColorStop(0, palette.accent);
                ringGrad.addColorStop(0.5, palette.primary);
                ringGrad.addColorStop(1, palette.accent);

                ctx.beginPath();
                ctx.strokeStyle = ringGrad;
                ctx.lineWidth = lineWidth * dpr;
                ctx.globalAlpha = 0.5 + energy * 0.5;

                for (let i = 0; i <= points; i++) {
                    const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
                    const binIndex = Math.floor(bandStart + (i / points) * (bandEnd - bandStart));
                    const binE = currentAnalyser
                        ? dataArray[Math.min(binIndex, dataArray.length - 1)] / 255
                        : amplitude / radius;

                    const displacement = binE * amplitude;
                    const phaseOff = phaseRef.current * (ri % 2 === 0 ? 1 : -1) * 0.3;
                    const wobble = Math.sin(angle * 6 + phaseOff) * amplitude * 0.15;
                    const r = radius + displacement + wobble;

                    const x = cx + r * Math.cos(angle);
                    const y = cy + r * Math.sin(angle);
                    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                }

                ctx.closePath();
                ctx.stroke();
                ctx.globalAlpha = 1;
            });

            // Centre dot
            ctx.beginPath();
            ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = palette.accent;
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
        };

        rafRef.current = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(rafRef.current);
            window.removeEventListener('resize', resize);
        };
    }, []); // ← empty: loop starts once, never restarts

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ display: 'block' }}
        />
    );
}