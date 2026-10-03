import { BASINS, type Vector } from "../../../src/engine.ts";

export type FieldVisualState = {
  latent: Vector;
  smoothedState: Vector;
  update: Vector;
  trail: Vector[];
  coherenceScore: number;
  phase: number;
  step: number;
  inputStrength: number;
  projected: boolean;
};

type Point = { x: number; y: number };

const TAU = Math.PI * 2;
const LATENT_LIMIT = 2;
const RADAR_INNER_RADIUS = 0.16;
const RADAR_SPAN = 0.8;
export const ZERO_BASELINE_RADIUS = RADAR_INNER_RADIUS + RADAR_SPAN / 2;

export function radarRadius(value: number): number {
  return RADAR_INNER_RADIUS
    + RADAR_SPAN * ((clamp(value, -LATENT_LIMIT, LATENT_LIMIT) + LATENT_LIMIT) / (2 * LATENT_LIMIT));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function projectVector(vector: Vector, radius: number): Point {
  let x = 0;
  let y = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const angle = -Math.PI / 2 + (i / vector.length) * TAU;
    x += vector[i] * Math.cos(angle);
    y += vector[i] * Math.sin(angle);
  }
  const scale = radius / (vector.length * 0.92);
  return { x: x * scale, y: y * scale };
}

function radarPoints(vector: Vector, radius: number): Point[] {
  return vector.map((value, index) => {
    const angle = -Math.PI / 2 + (index / vector.length) * TAU;
    const normalized = radarRadius(value);
    return {
      x: Math.cos(angle) * radius * normalized,
      y: Math.sin(angle) * radius * normalized,
    };
  });
}

function polygon(context: CanvasRenderingContext2D, points: Point[]): void {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

export class FieldVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private state?: FieldVisualState;
  private pulse?: Point;
  private pulseTimer?: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    this.context = context;
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(canvas);
  }

  update(state: FieldVisualState): void {
    this.state = state;
    this.render();
  }

  markPulse(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pulse = {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
    };
    this.render();
    if (this.pulseTimer !== undefined) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => {
      this.pulse = undefined;
      this.pulseTimer = undefined;
      this.render();
    }, 420);
  }

  destroy(): void {
    if (this.pulseTimer !== undefined) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = undefined;
    this.pulse = undefined;
    this.resizeObserver.disconnect();
  }

  private render(): void {
    const state = this.state;
    if (!state) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const context = this.context;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.save();
    context.translate(rect.width / 2, rect.height / 2);

    const radius = Math.min(rect.width, rect.height) * 0.39;
    const axisCount = state.latent.length;

    const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius * 1.34);
    glow.addColorStop(0, "rgba(80, 226, 209, 0.075)");
    glow.addColorStop(0.62, "rgba(88, 153, 255, 0.025)");
    glow.addColorStop(1, "rgba(7, 16, 20, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, radius * 1.34, 0, TAU);
    context.fill();

    for (let ring = 1; ring <= 4; ring += 1) {
      context.beginPath();
      context.arc(0, 0, radius * (ring / 4), 0, TAU);
      context.strokeStyle = ring === 4 ? "rgba(159, 190, 198, 0.24)" : "rgba(159, 190, 198, 0.10)";
      context.lineWidth = ring === 4 ? 1.2 : 1;
      context.stroke();
    }

    context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    // Engine phase is modulo-eight scheduler metadata, not an 12D coordinate.
    for (let i = 0; i < axisCount; i += 1) {
      const angle = -Math.PI / 2 + (i / axisCount) * TAU;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(x, y);
      context.strokeStyle = "rgba(159, 190, 198, 0.10)";
      context.stroke();
      context.fillStyle = "rgba(196, 218, 222, 0.55)";
      context.fillText(String(i + 1).padStart(2, "0"), Math.cos(angle) * radius * 1.09, Math.sin(angle) * radius * 1.09);
    }

    // Signed radar geometry places zero at mid-radius. Draw that baseline
    // explicitly so contraction toward zero cannot masquerade as a new attractor.
    const zeroBaseline = radarPoints(Array.from({ length: axisCount }, () => 0), radius);
    polygon(context, zeroBaseline);
    context.setLineDash([2, 5]);
    context.strokeStyle = "rgba(196, 218, 222, 0.30)";
    context.lineWidth = 1;
    context.stroke();
    context.setLineDash([]);
    context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "left";
    context.fillStyle = "rgba(196, 218, 222, 0.52)";
    context.fillText("0 baseline", radius * ZERO_BASELINE_RADIUS + 6, -7);
    context.textAlign = "center";

    for (const trailVector of state.trail.slice(-28)) {
      const point = projectVector(trailVector, radius);
      context.fillStyle = "rgba(78, 214, 201, 0.17)";
      context.fillRect(point.x - 1, point.y - 1, 2, 2);
    }

    // A projection boolean does not identify the emitted basin; keep all basin
    // markers neutral while the field outline carries the genuine event glow.
    BASINS.forEach((basin, index) => {
      const point = projectVector(basin.latent, radius);
      context.beginPath();
      context.arc(point.x, point.y, 3.2, 0, TAU);
      context.fillStyle = "rgba(255, 211, 138, 0.45)";
      context.fill();
      context.fillStyle = "rgba(207, 225, 228, 0.58)";
      context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(String(index + 1), point.x, point.y - 10);
    });

    const smoothed = radarPoints(state.smoothedState, radius);
    polygon(context, smoothed);
    context.setLineDash([4, 7]);
    context.strokeStyle = "rgba(72, 215, 204, 0.78)";
    context.lineWidth = 1.4;
    context.stroke();
    context.setLineDash([]);

    const field = radarPoints(state.latent, radius);
    polygon(context, field);
    const fieldFill = context.createLinearGradient(-radius, -radius, radius, radius);
    fieldFill.addColorStop(0, "rgba(255, 213, 138, 0.26)");
    fieldFill.addColorStop(0.52, "rgba(255, 125, 137, 0.14)");
    fieldFill.addColorStop(1, "rgba(74, 215, 203, 0.15)");
    context.fillStyle = fieldFill;
    context.fill();
    context.strokeStyle = state.projected ? "#ffe2a9" : "#f5c978";
    context.lineWidth = state.projected ? 2.8 : 1.8;
    context.shadowColor = state.projected ? "rgba(255, 220, 158, 0.72)" : "rgba(245, 201, 120, 0.34)";
    context.shadowBlur = state.projected ? 18 : 8;
    context.stroke();
    context.shadowBlur = 0;

    for (let i = 0; i < axisCount; i += 1) {
      const angle = -Math.PI / 2 + (i / axisCount) * TAU;
      const magnitude = clamp(Math.abs(state.update[i] ?? 0) / 1.4, 0, 1);
      const inner = radius * 0.72;
      const outer = inner + radius * 0.18 * magnitude;
      context.beginPath();
      context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      context.strokeStyle = (state.update[i] ?? 0) < 0 ? "rgba(255, 121, 137, 0.70)" : "rgba(93, 224, 210, 0.70)";
      context.lineWidth = 2;
      context.stroke();
    }

    // threshold is configurable and is not part of FieldVisualState, so this arc shows
    // only the engine-reported Coherence magnitude without threshold semantics.
    context.beginPath();
    context.arc(0, 0, radius * 1.055, -Math.PI / 2, -Math.PI / 2 + TAU * state.coherenceScore);
    context.strokeStyle = "#58d7ca";
    context.lineWidth = 3;
    context.stroke();

    const center = projectVector(state.latent, radius);
    context.beginPath();
    context.arc(center.x, center.y, 4.5, 0, TAU);
    context.fillStyle = "#f8fbf9";
    context.shadowColor = "rgba(255,255,255,.75)";
    context.shadowBlur = 10;
    context.fill();
    context.shadowBlur = 0;

    if (this.pulse) {
      context.beginPath();
      context.arc(this.pulse.x, this.pulse.y, 22, 0, TAU);
      context.strokeStyle = "rgba(255, 126, 144, 0.78)";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.arc(this.pulse.x, this.pulse.y, 7, 0, TAU);
      context.fillStyle = "rgba(255, 126, 144, 0.42)";
      context.fill();
    }

    context.restore();
  }
}
