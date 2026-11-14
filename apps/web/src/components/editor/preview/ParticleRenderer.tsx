import React, { useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { getParticleFrameDelta } from "./particle-time-utils";
import { getParticleBufferCapacity, groupParticlesIntoBlendRuns, injectParticleShaderAttributes, limitParticleBlendRuns } from "./particle-shader-utils";
import {
  getParticleEngine,
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

const createParticleGeometry = (capacity: number): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.userData.particleCapacity = capacity;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute("particleSize", new THREE.BufferAttribute(new Float32Array(capacity), 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(capacity), 1));
  return geometry;
};

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
  const materialsRef = useRef<Map<Particle["blendMode"], THREE.PointsMaterial>>(new Map());
  const runPoolRef = useRef<THREE.Points[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(currentTime);
  const lastSimulationTimeRef = useRef<number>(currentTime);
  const lastPausedTimeRef = useRef<number | null>(null);
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

  // The particle engine is shared; release this component's effects on unmount.
  useEffect(() => {
    return () => {
      for (const effectId of prevEffectIdsRef.current) {
        engine.removeEffect(effectId);
      }
      prevEffectIdsRef.current.clear();
    };
  }, [engine]);

  useEffect(() => {
    const currentIds = new Set(effects.map(e => e.id));
    const prevIds = prevEffectIdsRef.current;

    for (const effect of effects) {
      const existingEffect = engine.getEffect(effect.id);
      if (!existingEffect) {
        engine.addEffect(effect);
        continue;
      }

      // Existing IDs can still receive edited configuration, timing, and enabled state.
      if (JSON.stringify(existingEffect.config) !== JSON.stringify(effect.config)) {
        engine.updateEffect(effect.id, effect.config);
      }
      if (
        existingEffect.startTime !== effect.startTime ||
        existingEffect.duration !== effect.duration
      ) {
        engine.updateEffectTiming(effect.id, effect.startTime, effect.duration);
      }
      if (existingEffect.enabled !== effect.enabled) {
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

    const blendModes: Particle["blendMode"][] = ["normal", "add", "multiply", "screen"];
    const materials = new Map<Particle["blendMode"], THREE.PointsMaterial>();

    for (const blendMode of blendModes) {
      const blending = blendMode === "normal" ? THREE.NormalBlending
        : blendMode === "multiply" ? THREE.MultiplyBlending
        : blendMode === "screen" ? THREE.CustomBlending : THREE.AdditiveBlending;
      const material = new THREE.PointsMaterial({
        size: 12, vertexColors: true, transparent: true, opacity: 1, blending,
        ...(blendMode === "screen" ? {
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.SrcAlphaFactor,
          blendDst: THREE.OneMinusSrcColorFactor,
          blendEquationAlpha: THREE.AddEquation,
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        } : {}),
        // Three.js r182 requires premultiplied alpha for built-in MultiplyBlending.
        premultipliedAlpha: blendMode === "multiply",
        depthWrite: false, sizeAttenuation: false,
      });
      material.onBeforeCompile = injectParticleShaderAttributes;
      materials.set(blendMode, material);
    }

    materialsRef.current = materials;
    runPoolRef.current = [];
    setIsReady(true);

    return () => {
      setIsReady(false);

      // Stop any scheduled frame before releasing the WebGL resources it may use.
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      for (const points of runPoolRef.current) {
        points.geometry.dispose();
        scene.remove(points);
      }
      runPoolRef.current = [];

      // Dispose the materials created by this effect instance, not a later ref value.
      for (const material of materials.values()) material.dispose();
      if (materialsRef.current === materials) materialsRef.current.clear();

      renderer.dispose();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }

      if (rendererRef.current === renderer) rendererRef.current = null;
      if (sceneRef.current === scene) sceneRef.current = null;
      if (cameraRef.current === camera) cameraRef.current = null;
    };
  }, [width, height]);

  const hexToRgbNormalized = useCallback(
    (hex: string): { r: number; g: number; b: number } => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (result) {
        return {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
        };
      }
      const rgbMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(hex);
      if (rgbMatch) {
        return {
          r: parseInt(rgbMatch[1], 10) / 255,
          g: parseInt(rgbMatch[2], 10) / 255,
          b: parseInt(rgbMatch[3], 10) / 255,
        };
      }
      return { r: 1, g: 1, b: 1 };
    },
    []
  );

  const updateParticles = useCallback(
    (particles: Particle[]) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const MAX_PARTICLES_PER_FRAME = 10000;
      const MAX_BLEND_RUNS = 64;
      const runs = limitParticleBlendRuns(
        groupParticlesIntoBlendRuns(particles),
        MAX_BLEND_RUNS,
        MAX_PARTICLES_PER_FRAME,
      );

      // Keep draw objects pooled; allocate attribute storage only when a run grows.
      while (runPoolRef.current.length < runs.length) {
        const geometry = createParticleGeometry(0);
        const points = new THREE.Points(geometry, materialsRef.current.get(runs[runPoolRef.current.length].blendMode)!);
        points.frustumCulled = false;
        runPoolRef.current.push(points);
        scene.add(points);
      }

      for (let runIndex = 0; runIndex < runPoolRef.current.length; runIndex++) {
        const points = runPoolRef.current[runIndex];
        const run = runs[runIndex];
        if (!run) {
          points.visible = false;
          continue;
        }

        points.visible = true;
        points.renderOrder = runIndex;
        points.material = materialsRef.current.get(run.blendMode)!;
        let geometry = points.geometry;
        const count = run.particles.length;
        const currentCapacity = Number(geometry.userData.particleCapacity ?? 0);
        const nextCapacity = getParticleBufferCapacity(count, currentCapacity, MAX_PARTICLES_PER_FRAME);
        if (nextCapacity > currentCapacity) {
          const replacement = createParticleGeometry(nextCapacity);
          geometry.dispose();
          points.geometry = replacement;
          geometry = replacement;
        }
        geometry.setDrawRange(0, count);
        if (count === 0) {
          points.visible = false;
          continue;
        }

        const positions = geometry.attributes.position.array as Float32Array;
        const colors = geometry.attributes.color.array as Float32Array;
        const particleSizes = geometry.attributes.particleSize.array as Float32Array;
        const alphas = geometry.attributes.alpha.array as Float32Array;

        for (let i = 0; i < count; i++) {
          const particle = run.particles[i];
          const i3 = i * 3;
          positions[i3] = particle.position.x;
          positions[i3 + 1] = height - particle.position.y;
          positions[i3 + 2] = particle.position.z;
          const rgb = hexToRgbNormalized(particle.color);
          colors[i3] = rgb.r;
          colors[i3 + 1] = rgb.g;
          colors[i3 + 2] = rgb.b;
          alphas[i] = Math.max(0, Math.min(1, particle.opacity));
          particleSizes[i] = Math.max(0, particle.size);
        }

        const attributes = [
          [geometry.attributes.position, count * 3],
          [geometry.attributes.color, count * 3],
          [geometry.attributes.particleSize, count],
          [geometry.attributes.alpha, count],
        ] as const;
        for (const [attribute, activeLength] of attributes) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, activeLength);
          attribute.needsUpdate = true;
        }
      }
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
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !isPlayingRef.current) return;

      // Skip elapsed hidden-tab time; the editor timeline remains authoritative.
      lastSimulationTimeRef.current = currentTimeRef.current;
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isReady || !isPlaying) return;

    // Do not depend on currentTime here: the parent updates the playhead every
    // frame. Reading its ref avoids tearing down and restarting this RAF loop.
    lastSimulationTimeRef.current = currentTimeRef.current;

    const animate = () => {
      if (!isPlayingRef.current) return;

      if (document.visibilityState !== "visible") {
        lastSimulationTimeRef.current = currentTimeRef.current;
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Finish an incremental paused-seek reconstruction before resuming
      // live playback, so playback never continues from a partial particle state.
      if (engine.isSeeking()) {
        engine.advanceSeek();
        lastSimulationTimeRef.current = currentTimeRef.current;
        updateParticles(engine.getParticles());
        render();
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Use the editor's master timeline so playback-rate changes and seeks
      // stay synchronized with video, audio, and the timeline playhead.
      const timelineTime = currentTimeRef.current;
      const deltaTime = getParticleFrameDelta(timelineTime, lastSimulationTimeRef.current);
      lastSimulationTimeRef.current = timelineTime;

      engine.update(timelineTime, deltaTime);
      updateParticles(engine.getParticles());
      render();

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, isReady, engine, updateParticles, render]);

  useEffect(() => {
    if (!isReady || isPlaying) return;

    // Rebuild particle history incrementally when the paused playhead changes.
    if (lastPausedTimeRef.current !== currentTime) {
      engine.beginSeek(currentTime);
      lastPausedTimeRef.current = currentTime;
    }

    const advancePausedSeek = () => {
      const complete = engine.advanceSeek();
      updateParticles(engine.getParticles());
      render();

      if (!complete) {
        animationFrameRef.current = requestAnimationFrame(advancePausedSeek);
      } else {
        animationFrameRef.current = null;
      }
    };

    if (engine.isSeeking()) {
      advancePausedSeek();
    } else {
      updateParticles(engine.getParticles());
      render();
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, isReady, currentTime, engine, updateParticles, render]);

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
