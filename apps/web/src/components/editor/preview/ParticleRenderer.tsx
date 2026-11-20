import React, { useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { getParticleFrameDelta } from "./particle-time-utils";
import {
  getParticleBufferCapacity,
  clampParticlePointSize,
} from "./particle-shader-utils";
import {
  getParticleEngine,
  getParticleEffectsSeed,
  type Particle,
  type ParticleEffect,
} from "@fairarena/core";

type ParticleBlendMode = "normal" | "add" | "multiply" | "screen";

const MAX_PREVIEW_PARTICLES = 20_000;
const BLEND_MODES: ParticleBlendMode[] = ["normal", "add", "multiply", "screen"];

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
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setAttribute(
    "size",
    new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setAttribute(
    "opacity",
    new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.setDrawRange(0, 0);
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
  const geometriesRef = useRef<Map<ParticleBlendMode, THREE.BufferGeometry>>(new Map());
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
  const [contextRevision, setContextRevision] = React.useState(0);
  const maxPointSizeRef = useRef<number>(64);
  const contextLostRef = useRef<boolean>(false);
  const [effectsRevision, setEffectsRevision] = React.useState(0);

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
    let changed = false;

    for (const effect of effects) {
      const existingEffect = engine.getEffect(effect.id);
      if (!existingEffect) {
        engine.addEffect(effect);
        changed = true;
        continue;
      }

      // Existing IDs can still receive edited configuration, timing, and enabled state.
      if (JSON.stringify(existingEffect.config) !== JSON.stringify(effect.config)) {
        engine.updateEffect(effect.id, effect.config);
        changed = true;
      }
      if (
        existingEffect.startTime !== effect.startTime ||
        existingEffect.duration !== effect.duration
      ) {
        engine.updateEffectTiming(effect.id, effect.startTime, effect.duration);
        changed = true;
      }
      if (existingEffect.enabled !== effect.enabled) {
        engine.toggleEffect(effect.id, effect.enabled);
        changed = true;
      }
    }

    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        engine.removeEffect(prevId);
        changed = true;
      }
    }

    prevEffectIdsRef.current = currentIds;
    if (changed) setEffectsRevision((revision) => revision + 1);
  }, [effects, engine]);

  const colorCacheRef = useRef<Map<string, { r: number; g: number; b: number }>>(new Map());

  const hexToRgbNormalized = useCallback((value: string) => {
    const cache = colorCacheRef.current;
    const cached = cache.get(value);
    if (cached) return cached;

    let rgb = { r: 1, g: 1, b: 1 };
    const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value);
    const match = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(value);
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

  useEffect(() => {
    if (!containerRef.current || width <= 0 || height <= 0) {
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(0, width, height, 0, 0.1, 1000);
    camera.position.z = 100;
    cameraRef.current = camera;

    // WebGL may be unavailable or blocked by the browser/device. Keep the
    // editor usable instead of letting renderer construction crash the effect.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
      });
    } catch (error) {
      console.warn("Particle preview WebGL renderer is unavailable.", error);
      return;
    }
    const gl = renderer.getContext();
    const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    maxPointSizeRef.current = Number.isFinite(pointSizeRange?.[1]) && pointSizeRange[1] > 0
      ? pointSizeRange[1]
      : 64;
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

    // Three.js restores its WebGL resources after the browser emits the
    // restored event. Pause our own RAF loop while the context is unavailable.
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      contextLostRef.current = true;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
    const handleContextRestored = () => {
      contextLostRef.current = false;
      lastSimulatedTimeRef.current = currentTimeRef.current;
      setContextRevision((revision) => revision + 1);
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost, false);
    renderer.domElement.addEventListener("webglcontextrestored", handleContextRestored, false);

    // PR #1: Custom ShaderMaterial with explicit per-blend-mode factors.
    // The fragment shader outputs premultiplied RGB (color * alpha).
    // These factors implement source-over, additive, multiply and screen
    // compositing without applying particle opacity twice.
    const createMaterial = (blendMode: ParticleBlendMode) => {
      const blendFactors = blendMode === "add"
        ? { source: THREE.OneFactor, destination: THREE.OneFactor }
        : blendMode === "multiply"
          ? { source: THREE.DstColorFactor, destination: THREE.OneMinusSrcAlphaFactor }
          : blendMode === "screen"
            ? { source: THREE.OneFactor, destination: THREE.OneMinusSrcColorFactor }
            : { source: THREE.OneFactor, destination: THREE.OneMinusSrcAlphaFactor };

      const material = new THREE.ShaderMaterial({
        uniforms: {
          // gl_PointSize is measured in drawing-buffer pixels, while particle
          // sizes are authored in CSS pixels like the Canvas2D export renderer.
          uPixelRatio: { value: renderer.getPixelRatio() },
          uMinPointSize: { value: pointSizeRange?.[0] ?? 1 },
          uMaxPointSize: { value: maxPointSizeRef.current },
        },
        transparent: true,
        vertexColors: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: blendFactors.source,
        blendDst: blendFactors.destination,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        depthWrite: false,
        toneMapped: false,
        vertexShader: `
          attribute float size;
          attribute vec3 color;
          attribute float opacity;
          uniform float uPixelRatio;
          uniform float uMinPointSize;
          uniform float uMaxPointSize;
          varying vec3 vColor;
          varying float vOpacity;
          void main() {
            vColor = color;
            vOpacity = opacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            gl_PointSize = clamp(size * 5.6 * uPixelRatio, uMinPointSize, uMaxPointSize);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          varying float vOpacity;
          void main() {
            vec2 centered = gl_PointCoord - vec2(0.5);
            float distanceFromCenter = length(centered) * 2.0;
            if (distanceFromCenter > 1.0) discard;
            // Match the Canvas2D radial gradient: solid through 35% of
            // the radius, then a linear fade to transparent at the edge.
            float gradientAlpha = 1.0 - clamp(
              (distanceFromCenter - 0.35) / 0.65,
              0.0,
              1.0
            );
            float alpha = gradientAlpha * vOpacity;
            gl_FragColor = vec4(vColor * alpha, alpha);
          }
        `,
      });
      return material;
    };

    const materials = new Map<ParticleBlendMode, THREE.ShaderMaterial>();
    const geometries = new Map<ParticleBlendMode, THREE.BufferGeometry>();

    for (const blendMode of BLEND_MODES) {
      const geometry = createParticleGeometry(256);
      geometries.set(blendMode, geometry);
      const material = createMaterial(blendMode);
      materials.set(blendMode, material);
      const points = new THREE.Points(geometry, material);
      // Keep blend groups in a stable compositing order; transparent-object
      // depth sorting must not reshuffle these full-layer particle batches.
      points.renderOrder = BLEND_MODES.indexOf(blendMode);
      scene.add(points);
    }

    materials.forEach((material, blendMode) => {
      // Dispose material on cleanup handled below.
    });

    setIsReady(true);

    return () => {
      setIsReady(false);

      // Stop any scheduled frame before releasing the WebGL resources it may use.
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      for (const [blendMode, geometry] of geometries) {
        geometry.dispose();
        const material = materials.get(blendMode);
        if (material) material.dispose();
      }
      geometries.clear();
      materials.clear();

      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost, false);
      renderer.domElement.removeEventListener("webglcontextrestored", handleContextRestored, false);
      contextLostRef.current = false;
      renderer.dispose();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }

      if (rendererRef.current === renderer) rendererRef.current = null;
      if (sceneRef.current === scene) sceneRef.current = null;
      if (cameraRef.current === camera) cameraRef.current = null;
    };
  }, [width, height]);

  const updateParticles = useCallback(
    (particles: Particle[]) => {
      const geometries = geometriesRef.current;
      if (geometries.size === 0) return;

      const groups = new Map<ParticleBlendMode, Particle[]>();
      for (const blendMode of BLEND_MODES) {
        groups.set(blendMode, []);
      }
      const visibleParticleCount = Math.min(particles.length, MAX_PREVIEW_PARTICLES);
      for (let index = 0; index < visibleParticleCount; index++) {
        const particle = particles[index];
        groups.get(particle.blendMode)?.push(particle);
      }

      for (const [blendMode, geometry] of geometries) {
        const group = groups.get(blendMode) ?? [];
        const count = group.length;
        const currentPosition = geometry.getAttribute("position") as THREE.BufferAttribute;
        const currentCapacity = currentPosition.array.length / 3;
        if (count > currentCapacity) {
          const capacity = getParticleBufferCapacity(count, currentCapacity, MAX_PREVIEW_PARTICLES);
          geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
          );
          geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage)
          );
          geometry.setAttribute(
            "size",
            new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
          );
          geometry.setAttribute(
            "opacity",
            new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage)
          );
        }

        const positions = (geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
        const colors = (geometry.getAttribute("color") as THREE.BufferAttribute).array as Float32Array;
        const sizes = (geometry.getAttribute("size") as THREE.BufferAttribute).array as Float32Array;
        const opacities = (geometry.getAttribute("opacity") as THREE.BufferAttribute).array as Float32Array;

        for (let i = 0; i < count; i++) {
          const particle = group[i];
          const i3 = i * 3;
          positions[i3] = particle.position.x;
          positions[i3 + 1] = height - particle.position.y;
          positions[i3 + 2] = particle.position.z;

          const rgb = hexToRgbNormalized(particle.color);
          colors[i3] = rgb.r;
          colors[i3 + 1] = rgb.g;
          colors[i3 + 2] = rgb.b;
          sizes[i] = particle.size;
          opacities[i] = Math.max(0, Math.min(1, particle.opacity));
        }

        (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
        (geometry.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
        (geometry.getAttribute("opacity") as THREE.BufferAttribute).needsUpdate = true;
        geometry.setDrawRange(0, count);
      }
    },
    [hexToRgbNormalized, height]
  );

  const render = useCallback(() => {
    if (contextLostRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Visibility safeguard: skip elapsed hidden-tab time so the timeline
  // remains authoritative.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !isPlayingRef.current) return;
      lastSimulatedTimeRef.current = currentTimeRef.current;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isReady || !isPlaying || contextLostRef.current) return;

    lastSimulatedTimeRef.current = currentTimeRef.current;

    const animate = () => {
      if (!isPlayingRef.current) return;
      if (contextLostRef.current) return;

      if (document.visibilityState !== "visible") {
        lastSimulatedTimeRef.current = currentTimeRef.current;
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Finish an incremental paused-seek reconstruction before resuming
      // live playback, so playback never continues from a partial particle state.
      if (engine.isSeeking()) {
        engine.advanceSeek();
        lastSimulatedTimeRef.current = currentTimeRef.current;
        updateParticles(engine.getParticles());
        render();
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Use the editor's master timeline so playback-rate changes and seeks
      // stay synchronized with video, audio, and the timeline playhead.
      const timelineTime = currentTimeRef.current;
      const deltaTime = getParticleFrameDelta(timelineTime, lastSimulatedTimeRef.current);
      lastSimulatedTimeRef.current = timelineTime;

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
  }, [isPlaying, isReady, contextRevision, engine, updateParticles, render]);

  // Paused playhead: rebuild particle history incrementally via beginSeek/advanceSeek.
  useEffect(() => {
    if (!isReady || isPlaying || contextLostRef.current) return;

    if (
      lastSimulatedTimeRef.current !== currentTime ||
      effectsRevision !== 0
    ) {
      engine.beginSeek(currentTime);
      lastSimulatedTimeRef.current = currentTime;
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
      // On playhead change while paused, seek to the absolute time.
      if (lastSeekRef.current.time !== currentTime || lastSeekRef.current.seed !== particleSeed) {
        engine.seekToTime(currentTime, 1 / 30, particleSeed);
        lastSeekRef.current = { time: currentTime, seed: particleSeed };
        lastSimulatedTimeRef.current = currentTime;
      }
      updateParticles(engine.getParticles());
      render();
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, isReady, contextRevision, effectsRevision, currentTime, engine, updateParticles, render, particleSeed]);

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
