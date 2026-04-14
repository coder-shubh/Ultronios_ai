'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';

/** Warm sun + golden “dust in sunlight” + soft highlights — pairs with CSS sky. */
function Sun() {
  const core = useRef<THREE.Mesh>(null);
  const corona = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (core.current) {
      core.current.rotation.y = t * 0.12;
      const pulse = 1 + Math.sin(t * 1.1) * 0.035;
      core.current.scale.setScalar(pulse);
    }
    if (corona.current) {
      corona.current.rotation.z = t * 0.05;
      corona.current.scale.setScalar(1.08 + Math.sin(t * 0.9) * 0.04);
    }
    if (glow.current) {
      glow.current.scale.setScalar(1.2 + Math.sin(t * 0.7) * 0.06);
    }
  });

  return (
    <group position={[14, 10, 2]}>
      <mesh ref={glow}>
        <sphereGeometry args={[4.2, 48, 48]} />
        <meshBasicMaterial
          color="#fef9c3"
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={corona}>
        <sphereGeometry args={[2.4, 48, 48]} />
        <meshBasicMaterial
          color="#fde047"
          transparent
          opacity={0.45}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={core}>
        <sphereGeometry args={[1.35, 64, 64]} />
        <meshBasicMaterial color="#facc15" />
      </mesh>
    </group>
  );
}

function SunlitParticles() {
  return (
    <>
      <Sparkles
        count={220}
        scale={38}
        size={2.8}
        speed={0.3}
        opacity={0.5}
        color="#fbbf24"
      />
      <group position={[-6, -8, -4]}>
        <Sparkles
          count={90}
          scale={22}
          size={2}
          speed={0.18}
          opacity={0.35}
          color="#fef3c7"
        />
      </group>
    </>
  );
}

export default function LandingWebGLSunny() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] h-full min-h-[100dvh] w-full"
      aria-hidden
    >
      <Canvas
        camera={{ position: [0, 2, 24], fov: 44 }}
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
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Sun />
        <SunlitParticles />
      </Canvas>
    </div>
  );
}
