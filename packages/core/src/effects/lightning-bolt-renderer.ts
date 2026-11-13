export type LightningCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export interface LightningBoltOptions {
  start: { x: number; y: number };
  end: { x: number; y: number };
  segments?: number;
  branches?: number;
  amplitude?: number;
  color?: string;
  lineWidth?: number;
  glow?: number;
  seed?: number;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    let value = (state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw a deterministic, jagged lightning bolt between two canvas points.
 * The caller owns animation timing and clears/redraws the canvas each frame.
 */
export function renderLightningBolt(
  context: LightningCanvasContext,
  options: LightningBoltOptions,
): void {
  const {
    start,
    end,
    segments = 18,
    branches = 2,
    amplitude = 24,
    color = "#b9e7ff",
    lineWidth = 3,
    glow = 18,
    seed = 1,
  } = options;

  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y) ||
    segments < 1 ||
    lineWidth <= 0
  ) {
    return;
  }

  const random = createRandom(seed);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;

  const normalX = -dy / length;
  const normalY = dx / length;
  const points: Array<{ x: number; y: number }> = [];

  for (let index = 0; index <= segments; index++) {
    const progress = index / segments;
    const displacement =
      index === 0 || index === segments
        ? 0
        : (random() * 2 - 1) * amplitude;
    points.push({
      x: start.x + dx * progress + normalX * displacement,
      y: start.y + dy * progress + normalY * displacement,
    });
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.shadowColor = color;
  context.shadowBlur = Math.max(0, glow);
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();

  context.shadowBlur = 0;
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1, lineWidth * 0.35);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();

  for (let branch = 0; branch < branches; branch++) {
    const originIndex = 1 + Math.floor(random() * Math.max(1, segments - 2));
    const origin = points[originIndex];
    const direction = random() < 0.5 ? -1 : 1;
    const branchLength = length * (0.12 + random() * 0.2);
    const branchAngle = Math.atan2(dy, dx) + direction * (0.45 + random() * 0.7);
    const branchEnd = {
      x: origin.x + Math.cos(branchAngle) * branchLength,
      y: origin.y + Math.sin(branchAngle) * branchLength,
    };
    const middle = {
      x: (origin.x + branchEnd.x) / 2 + normalX * (random() - 0.5) * amplitude,
      y: (origin.y + branchEnd.y) / 2 + normalY * (random() - 0.5) * amplitude,
    };

    context.strokeStyle = color;
    context.lineWidth = Math.max(1, lineWidth * 0.55);
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(middle.x, middle.y);
    context.lineTo(branchEnd.x, branchEnd.y);
    context.stroke();
  }

  context.restore();
}

/** Build a timeline-ready lightning clip with safe cinematic defaults. */
export function createLightningEffectClip(
  id: string,
  startTime: number,
  duration: number,
  start: { x: number; y: number } = { x: 0.5, y: 0.08 },
  end: { x: number; y: number } = { x: 0.5, y: 0.92 },
) {
  return {
    id,
    name: "Lightning Strike",
    startTime: Math.max(0, startTime),
    duration: Math.max(0.05, duration),
    start: {
      x: Math.max(0, Math.min(1, start.x)),
      y: Math.max(0, Math.min(1, start.y)),
    },
    end: {
      x: Math.max(0, Math.min(1, end.x)),
      y: Math.max(0, Math.min(1, end.y)),
    },
    color: "#9bdcff",
    intensity: 0.9,
    segments: 18,
    branches: 3,
    amplitude: 24,
    enabled: true,
  } as const;
}
