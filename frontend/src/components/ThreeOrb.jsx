import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';

// ─── Orbital Ring ──────────────────────────────────────────────────────────────
function OrbitalRing({ radius, tilt, speed, status, colorIdle, colorActive }) {
  const ref = useRef();
  const count = 180;

  const { positions } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = 0;
    }
    return { positions };
  }, [radius]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.rotation.z = t * speed;

    const mat = ref.current.material;

    if (status === 'speaking') {
      mat.color.setStyle(colorActive);
      mat.opacity = 0.9 + Math.sin(t * 8) * 0.1;
      mat.size = 0.025 + Math.sin(t * 12) * 0.008;
    } else if (status === 'listening') {
      mat.color.setStyle(colorIdle);
      mat.opacity = 0.5 + Math.sin(t * 2) * 0.1;
      mat.size = 0.018;
    } else if (status === 'connecting') {
      mat.color.setStyle('#eab308');
      mat.opacity = 0.4 + Math.sin(t * 4) * 0.15;
      mat.size = 0.015;
    } else {
      mat.color.setStyle('#334155');
      mat.opacity = 0.3;
      mat.size = 0.012;
    }
  });

  return (
    <group rotation={[tilt, 0, 0]}>
      <points ref={ref}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={positions}
            count={count}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.018}
          color={colorIdle}
          transparent
          opacity={0.5}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </group>
  );
}

// ─── Wave Sphere (core plasma ball) ────────────────────────────────────────────
function WaveSphere({ status }) {
  const meshRef = useRef();
  const geoRef = useRef();

  const basePositions = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.72, 64, 64);
    return new Float32Array(geo.attributes.position.array);
  }, []);

  useFrame((state) => {
    if (!meshRef.current || !geoRef.current) return;
    const t = state.clock.elapsedTime;
    const pos = geoRef.current.attributes.position;
    const arr = pos.array;

    let amp = 0;
    let freq = 0;
    let targetScale = 1;
    let targetEmissive = new THREE.Color('#000000');

    if (status === 'speaking') {
      amp = 0.14 + Math.sin(t * 3) * 0.04;
      freq = 5 + Math.sin(t * 7) * 2;
      targetScale = 1.05 + Math.sin(t * 12) * 0.03;
      targetEmissive = new THREE.Color('#0ea5e9').multiplyScalar(0.4);
    } else if (status === 'listening') {
      amp = 0.05 + Math.sin(t * 1.5) * 0.015;
      freq = 3;
      targetScale = 1.0;
      targetEmissive = new THREE.Color('#06b6d4').multiplyScalar(0.15);
    } else if (status === 'connecting') {
      amp = 0.03;
      freq = 2;
      targetScale = 0.95;
      targetEmissive = new THREE.Color('#eab308').multiplyScalar(0.1);
    } else {
      amp = 0.015;
      freq = 1.5;
      targetScale = 0.9;
    }

    for (let i = 0; i < arr.length / 3; i++) {
      const ox = basePositions[i * 3];
      const oy = basePositions[i * 3 + 1];
      const oz = basePositions[i * 3 + 2];
      const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const nx = ox / len, ny = oy / len, nz = oz / len;
      const wave = Math.sin(ny * freq + t * 4) * Math.cos(nx * freq + t * 3) * amp;
      arr[i * 3] = ox + nx * wave;
      arr[i * 3 + 1] = oy + ny * wave;
      arr[i * 3 + 2] = oz + nz * wave;
    }
    pos.needsUpdate = true;
    geoRef.current.computeVertexNormals();

    meshRef.current.scale.setScalar(
      THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.08)
    );
    meshRef.current.material.emissive.lerp(targetEmissive, 0.06);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry ref={geoRef} args={[0.72, 64, 64]} />
      <meshStandardMaterial
        color="#0a0f1e"
        emissive="#000000"
        emissiveIntensity={1}
        metalness={0.9}
        roughness={0.1}
        envMapIntensity={1.2}
        transparent
        opacity={0.95}
      />
    </mesh>
  );
}

// ─── Floating Particles ─────────────────────────────────────────────────────────
function FloatingParticles({ status }) {
  const ref = useRef();
  const count = 120;

  const { positions, randoms } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.4 + Math.random() * 1.2;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      randoms[i] = Math.random() * Math.PI * 2;
    }
    return { positions, randoms };
  }, []);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const mat = ref.current.material;
    if (status === 'speaking') {
      mat.opacity = 0.6 + Math.sin(t * 7) * 0.2;
      mat.size = 0.02;
      mat.color.setStyle('#7dd3fc');
    } else if (status === 'listening') {
      mat.opacity = 0.25;
      mat.size = 0.012;
      mat.color.setStyle('#38bdf8');
    } else {
      mat.opacity = 0.1;
      mat.size = 0.008;
      mat.color.setStyle('#1e3a5f');
    }
    ref.current.rotation.y = t * 0.05;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={count} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.012} color="#38bdf8" transparent opacity={0.25} sizeAttenuation depthWrite={false} />
    </points>
  );
}

// ─── Scene ──────────────────────────────────────────────────────────────────────
function Scene({ status }) {
  const groupRef = useRef();
  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.08;
  });

  return (
    <group ref={groupRef}>
      <WaveSphere status={status} />
      <OrbitalRing radius={1.05} tilt={0} speed={0.4} status={status} colorIdle="#0e7490" colorActive="#22d3ee" />
      <OrbitalRing radius={1.05} tilt={Math.PI / 3} speed={-0.3} status={status} colorIdle="#1d4ed8" colorActive="#60a5fa" />
      <OrbitalRing radius={1.05} tilt={Math.PI / 1.5} speed={0.25} status={status} colorIdle="#0f766e" colorActive="#34d399" />
      <OrbitalRing radius={1.18} tilt={Math.PI / 4} speed={0.15} status={status} colorIdle="#0c4a6e" colorActive="#7dd3fc" />
      <FloatingParticles status={status} />
    </group>
  );
}

export default function ThreeOrb({ status }) {
  return (
    <Canvas camera={{ position: [0, 0, 4.5], fov: 42 }} style={{ background: 'transparent' }}>
      <ambientLight intensity={0.3} />
      <pointLight position={[4, 4, 4]} intensity={3} color="#38bdf8" />
      <pointLight position={[-4, -4, -4]} intensity={1.5} color="#6366f1" />
      <pointLight position={[0, 4, -4]} intensity={1} color="#0ea5e9" />
      <Environment preset="night" />
      <Scene status={status} />
    </Canvas>
  );
}