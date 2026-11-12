import React, { useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import {
  getParticleEngine,
  getParticleEffectsSeed,
  type Particle,
  type ParticleEffect,
} from "@fairarena/core";

interface ParticleRendererProps {
  effects: ParticleEffect[];
  width: number;
  height: number;
  currentTime: number;
  isPlaying: boolean;
}

export const ParticleRenderer: React.FC<ParticleRendererProps> = ({
  effects,
  width,
  height,
  currentTime,
  isPlaying,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(currentTime);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const playStartTimeRef = useRef<number>(0);
  const playStartPlayheadRef = useRef<number>(0);
  const lastSimulatedTimeRef = useRef<number>(currentTime);
  const lastSeekRef = useRef<{ time: number; seed: number }>({ time: -1, seed: -1 });
  const particleSeed = useMemo(() => getParticleEffectsSeed(effects), [effects]);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const [isReady, setIsReady] = React.useState(false);

  const engine = useMemo(() => getParticleEngine(), []);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    engine.setCanvasSize(width, height);
  }, [engine, width, height]);

  const prevEffectIdsRef = useRef<Set<string>>(new Set());

  // This component owns only the effect IDs it receives. Remove those IDs
  // on unmount so a project switch cannot leave stale emitters in the shared engine.
  useEffect(() => {
    return () => {
      for (const effectId of prevEffectIdsRef.current) {
        engine.removeEffect(effectId);
      }
      prevEffectIdsRef.current = new Set();
    };
  }, [engine]);

  useEffect(() => {
    const currentIds = new Set(effects.map(e => e.id));
    const prevIds = prevEffectIdsRef.current;

    for (const effect of effects) {
      const existingEffect = engine.getEffect(effect.id);
      if (!existingEffect) {
        engine.addEffect(effect);
      } else {
        // Keep inspector edits (including timing and enable state) live in preview.
        engine.updateEffect(effect.id, effect.config);
        engine.updateEffectTiming(effect.id, effect.startTime, effect.duration);
        engine.toggleEffect(effect.id, effect.enabled);
      }
    }

    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        engine.removeEffect(prevId);
      }
    }

    prevEffectIdsRef.current = currentIds;
  }, [effects, engine]);

  useEffect(() => {
    if (!containerRef.current || width <= 0 || height <= 0) {
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(
      0,
      width,
      height,
      0,
      0.1,
      1000
    );
    camera.position.z = 100;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.objectFit = "contain";
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.left = "0";
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const geometry = new THREE.BufferGeometry();
    const initialCapacity = 256;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(initialCapacity * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(initialCapacity * 3), 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(new Float32Array(initialCapacity), 1));
    geometry.setDrawRange(0, 0);
    geometryRef.current = geometry;

    const material = new THREE.PointsMaterial({
      size: 12,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    setIsReady(true);

    return () => {
      setIsReady(false);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentElement === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (geometryRef.current === geometry) geometryRef.current = null;
      if (rendererRef.current === renderer) rendererRef.current = null;
      if (sceneRef.current === scene) sceneRef.current = null;
      if (cameraRef.current === camera) cameraRef.current = null;
    };
  }, [width, height]);

  const colorCacheRef = useRef<Map<string, { r: number; g: number; b: number }>>(new Map());

  const hexToRgbNormalized = useCallback((value: string) => {
    const cache = colorCacheRef.current;
    const cached = cache.get(value);
    if (cached) return cached;

    let rgb = { r: 1, g: 1, b: 1 };
    const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
    const match = /^rgb\((\d+),\\s*(\d+),\\s*(\d+)\)$/i.exec(value);
    if (hex) {
      rgb = {
        r: parseInt(hex[1], 16) / 255,
        g: parseInt(hex[2], 16) / 255,
        b: parseInt(hex[3], 16) / 255,
      };
    } else if (match) {
      rgb = {
        r: parseInt(match[1], 10) / 255,
        g: parseInt(match[2], 10) / 255,
        b: parseInt(match[3], 10) / 255,
      };
    }
    if (cache.size >= 256) cache.clear();
    cache.set(value, rgb);
    return rgb;
  }, []);

  const updateParticles = useCallback(
    (particles: Particle[]) => {
      const geometry = geometryRef.current;
      if (!geometry) return;

      const count = Math.min(particles.length, 10000);
      const currentPosition = geometry.getAttribute("position") as THREE.BufferAttribute;
      const currentCapacity = currentPosition.array.length / 3;
      if (count > currentCapacity) {
        const capacity = Math.min(10000, 2 ** Math.ceil(Math.log2(count)));
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
        geometry.setAttribute("size", new THREE.BufferAttribute(new Float32Array(capacity), 1));
      }

      const positions = (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
      const colors = (geometry.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
      const sizes = (geometry.getAttribute("size") as THREE.BufferAttribute).array as Float32Array;

      for (let i = 0; i < count; i++) {
        const particle = particles[i];
        const i3 = i * 3;
        positions[i3] = particle.position.x;
        positions[i3 + 1] = height - particle.position.y;
        positions[i3 + 2] = particle.position.z;

        const rgb = hexToRgbNormalized(particle.color);
        colors[i3] = rgb.r * particle.opacity;
        colors[i3 + 1] = rgb.g * particle.opacity;
        colors[i3 + 2] = rgb.b * particle.opacity;
        sizes[i] = particle.size;
      }

      (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
      geometry.setDrawRange(0, count);
    },
    [hexToRgbNormalized, height]
  );

  const render = useCallback(() => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!isReady) return;

    if (isPlaying) {
      playStartTimeRef.current = performance.now();
      playStartPlayheadRef.current = currentTimeRef.current;
      engine.seekToTime(playStartPlayheadRef.current, 1 / 30, particleSeed);
      lastSeekRef.current = { time: playStartPlayheadRef.current, seed: particleSeed };
      lastSimulatedTimeRef.current = currentTimeRef.current;
      lastFrameTimeRef.current = performance.now();

      const animate = () => {
        if (!isPlayingRef.current) return;

        const now = performance.now();
        const deltaMs = now - lastFrameTimeRef.current;
        lastFrameTimeRef.current = now;
        const elapsedSinceStart = (now - playStartTimeRef.current) / 1000;
        const estimatedCurrentTime = playStartPlayheadRef.current + elapsedSinceStart;
        const fixedStep = 1 / 30;
        let simulationAdvanced = false;
        if (deltaMs > 500) {
          engine.seekToTime(estimatedCurrentTime, fixedStep, particleSeed);
          lastSimulatedTimeRef.current = estimatedCurrentTime;
          simulationAdvanced = true;
        } else {
          while (lastSimulatedTimeRef.current + fixedStep <= estimatedCurrentTime) {
            lastSimulatedTimeRef.current += fixedStep;
            engine.update(lastSimulatedTimeRef.current, fixedStep);
            simulationAdvanced = true;
          }
        }
        // The particle image is unchanged between fixed simulation ticks.
        // Avoid uploading GPU buffers and issuing duplicate WebGL draws at 60/120 Hz.
        if (simulationAdvanced) {
          updateParticles(engine.getParticles());
          render();
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    } else {
      if (lastSeekRef.current.time !== currentTime || lastSeekRef.current.seed !== particleSeed) {
        engine.seekToTime(currentTime, 1 / 30, particleSeed);
        lastSeekRef.current = { time: currentTime, seed: particleSeed };
        lastSimulatedTimeRef.current = currentTime;
      }
      const particles = engine.getParticles();
      updateParticles(particles);
      render();
    }
  }, [isPlaying, isReady, currentTime, engine, updateParticles, render, effects, particleSeed]);

  useEffect(() => {
    if (cameraRef.current) {
      cameraRef.current.left = 0;
      cameraRef.current.right = width;
      cameraRef.current.top = height;
      cameraRef.current.bottom = 0;
      cameraRef.current.updateProjectionMatrix();
    }
    if (rendererRef.current) {
      rendererRef.current.setSize(width, height, false);
    }
  }, [width, height]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 50 }}
    />
  );
};

export default ParticleRenderer;
