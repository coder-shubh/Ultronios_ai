'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Layered starfield + subtle sparkles; slow rotation for depth.
 * Canvas is fully transparent so CSS gradient/orbs show through.
 */
function RotatingStars() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.035;
    group.current.rotation.x += delta * 0.012;
  });

  return (
    <group ref={group}>
      {/* Dense inner field */}
      <Stars
        radius={85}
        depth={65}
        count={7000}
        factor={3.2}
        saturation={0.12}
        fade
        speed={0.4}
      />
      {/* Sparse outer halo */}
      <Stars
        radius={130}
        depth={95}
        count={3200}
        factor={5.5}
        saturation={0.06}
        fade
        speed={0.25}
      />
    </group>
  );
}

function Dust() {
  return (
    <Sparkles
      count={160}
      scale={28}
      size={2.2}
      speed={0.35}
      opacity={0.45}
      color="#c4b5fd"
    />
  );
}

export default function LandingWebGL() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] h-full min-h-[100dvh] w-full"
      aria-hidden
    >
      <Canvas
        camera={{ position: [0, 0, 18], fov: 48 }}
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        dpr={[1, 1.75]}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.toneMapping = THREE.NoToneMapping;
        }}
      >
        <RotatingStars />
        <Dust />
      </Canvas>
    </div>
  );
}
