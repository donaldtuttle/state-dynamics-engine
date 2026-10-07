import { BASINS, type Mechanisms, type Vector } from "../../../src/engine.ts";

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
  mechanisms: Readonly<Mechanisms>;
  summaries: ReadonlyArray<{ id: number; latent: Vector; step: number }>;
  recall: { latent: Vector; similarity: number } | null;
};

type Point = { x: number; y: number };
type Mote = { angle: number; radius: number; speed: number; life: number };
const TAU = Math.PI * 2;
const AXES = 12;
const COLORS = ["196,165,116", "110,155,150", "142,160,184", "196,137,122"];
const LAYERS = [
  ["projection", "Basin projection"],
  ["memory", "Memory influence"],
  ["summaries", "History summaries"],
  ["noise", "Adaptive noise"],
] as const;

// Retained for consumers of the original fixed-scale radar helper.
// The animated display below uses the requested peak-normalized geometry.
export const ZERO_BASELINE_RADIUS = 0.16 + 0.8 / 2;
export function radarRadius(value: number): number {
  return 0.16 + 0.8 * ((clamp(value, -2, 2) + 2) / 4);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function starPoints(vector: readonly number[], radius: number, amplitude = 0.46): Point[] {
  const peak = Math.max(0.28, ...vector.map(Math.abs));
  return Array.from({ length: AXES }, (_, i) => {
    const angle = (i / AXES) * TAU - Math.PI / 2;
    const r = radius * 0.48 + (0.42 + ((vector[i] ?? 0) / peak) * 0.58) * radius * amplitude;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

function spline(context: CanvasRenderingContext2D, points: Point[]): void {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i += 1) {
    const p0 = points[(i + points.length - 1) % points.length];
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = points[(i + 2) % points.length];
    context.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y,
    );
  }
  context.closePath();
}

export class FieldVisualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly legend: HTMLDivElement;
  private state?: FieldVisualState;
  private display: Vector = [];
  private displaySmoothed: Vector = [];
  private displayCoherence = 0;
  private flash = 0;
  private motes: Mote[] = [];
  private pulse?: Point & { started: number };
  private animationFrame = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    this.context = context;
    this.legend = document.createElement("div");
    this.legend.className = "mechanism-legend";
    this.legend.setAttribute("aria-label", "Mechanisms");
    for (const [key, name] of LAYERS) {
      const chip = document.createElement("span");
      chip.className = "mechanism-chip";
      chip.dataset.mechanism = key;
      chip.textContent = name;
      this.legend.append(chip);
    }
    canvas.after(this.legend);
    if (!this.motion.matches) this.motes = Array.from({ length: 28 }, () => this.spawnMote());
    this.animationFrame = window.requestAnimationFrame(this.animate);
  }

  update(state: FieldVisualState): void {
    const reset = !this.state || state.step < this.state.step || state.step === 0;
    const newCommit = !this.state || state.step !== this.state.step;
    // These copies belong only to the renderer; no display values flow back.
    if (reset) {
      this.display = [...state.latent];
      this.displaySmoothed = [...state.smoothedState];
      this.displayCoherence = state.coherenceScore;
      this.flash = 0;
      this.pulse = undefined;
      this.motes = this.motion.matches ? [] : Array.from({ length: 28 }, () => this.spawnMote());
    }
    if (state.projected && newCommit && !this.motion.matches) this.flash = 1;
    this.state = state;
    for (const chip of this.legend.children) {
      const key = (chip as HTMLElement).dataset.mechanism as keyof Mechanisms;
      const enabled = state.mechanisms[key];
      chip.setAttribute("data-enabled", String(enabled));
      chip.setAttribute("aria-label", chip.textContent + (enabled ? ": on" : ": off"));
    }
  }

  markPulse(clientX: number, clientY: number): void {
    if (this.motion.matches) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pulse = {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2,
      started: performance.now(),
    };
  }

  destroy(): void {
    this.destroyed = true;
    window.cancelAnimationFrame(this.animationFrame);
    this.legend.remove();
    this.motes = [];
    this.pulse = undefined;
  }

  private spawnMote(): Mote {
    // Cosmetic randomness only. Never import or consume the engine PRNG.
    return {
      angle: Math.random() * TAU,
      radius: 0.92 + Math.random() * 0.08,
      speed: 0.002 + Math.random() * 0.002,
      life: 1,
    };
  }

  private readonly animate = (now: number): void => {
    if (this.destroyed) return;
    const state = this.state;
    const reduced = this.motion.matches;
    if (state) {
      const factor = reduced ? 1 : 0.18;
      for (let i = 0; i < AXES; i += 1) {
        this.display[i] = reduced ? state.latent[i]
          : this.display[i] + (state.latent[i] - this.display[i]) * factor;
        this.displaySmoothed[i] = reduced ? state.smoothedState[i]
          : this.displaySmoothed[i] + (state.smoothedState[i] - this.displaySmoothed[i]) * factor;
      }
      this.displayCoherence = reduced ? state.coherenceScore
        : this.displayCoherence + (state.coherenceScore - this.displayCoherence) * factor;
      if (reduced) {
        this.flash = 0;
        this.motes = [];
        this.pulse = undefined;
      } else {
        for (const mote of this.motes) {
          mote.radius -= mote.speed;
          mote.life -= 0.007;
        }
        this.motes = this.motes.filter(mote => mote.radius >= 0.16 && mote.life > 0);
        if (state.mechanisms.noise && this.motes.length < 90
          && Math.random() < 0.45 + state.inputStrength * 0.5) {
          const count = Math.min(3, 90 - this.motes.length);
          for (let i = 0; i < count; i += 1) this.motes.push(this.spawnMote());
        }
      }
      this.render(now);
      this.flash *= 0.92;
    }
    this.animationFrame = window.requestAnimationFrame(this.animate);
  };

  private render(now: number): void {
    const state = this.state;
    if (!state) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
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
    const radius = Math.min(rect.width, rect.height) * 0.46;
    const coherence = clamp(this.displayCoherence, 0, 1);

    const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius * 0.48);
    glow.addColorStop(0, "rgba(196,165,116,0.16)");
    glow.addColorStop(1, "rgba(196,165,116,0)");
    context.fillStyle = glow;
    context.fillRect(-radius, -radius, radius * 2, radius * 2);

    for (let i = 0; i < AXES; i += 1) {
      const angle = (i / AXES) * TAU - Math.PI / 2;
      context.beginPath();
      context.moveTo(Math.cos(angle) * radius * 0.18, Math.sin(angle) * radius * 0.18);
      context.lineTo(Math.cos(angle) * radius * 1.02, Math.sin(angle) * radius * 1.02);
      context.strokeStyle = "rgba(197,204,214,0.28)";
      context.lineWidth = 1;
      context.stroke();
    }
    LAYERS.forEach(([key], i) => {
      const r = radius * (0.38 + i * 0.20);
      const enabled = state.mechanisms[key];
      context.beginPath();
      context.arc(0, 0, r, 0, TAU);
      context.strokeStyle = enabled ? `rgb(${COLORS[i]})` : "rgba(197,204,214,0.14)";
      context.lineWidth = 0.8;
      context.stroke();
      if (enabled) {
        context.beginPath();
        context.moveTo(0, -r - 3);
        context.lineTo(0, -r + 3);
        context.lineWidth = 2.4;
        context.stroke();
      }
    });

    context.beginPath();
    context.arc(0, 0, radius * (0.14 + coherence * 0.2), 0, TAU);
    context.fillStyle = `rgba(196,165,116,${0.08 + coherence * 0.18})`;
    context.fill();
    context.strokeStyle = state.mechanisms.projection ? "rgba(243,234,210,0.6)" : "rgba(197,204,214,0.14)";
    context.lineWidth = 1;
    context.stroke();

    // Keep the committed trail binding, without painting stale stroke trails.
    // The latest committed point is a quiet neutral locator, not a summary.
    const lastTrail = state.trail.at(-1);
    if (lastTrail) {
      const point = centroid(starPoints(lastTrail, radius));
      context.beginPath();
      context.arc(point.x, point.y, 1.5, 0, TAU);
      context.fillStyle = "rgba(197,204,214,0.3)";
      context.fill();
    }

    if (state.mechanisms.projection) {
      // Neutral dashed basin markers; no inferred selection or second gold star.
      for (const basin of BASINS) {
        const point = centroid(starPoints(basin.latent, radius));
        context.beginPath();
        context.setLineDash([2, 3]);
        context.arc(point.x, point.y, 4, 0, TAU);
        context.strokeStyle = "rgba(196,165,116,0.45)";
        context.lineWidth = 1;
        context.stroke();
      }
      context.setLineDash([]);
    }

    spline(context, starPoints(this.displaySmoothed, radius, 0.42));
    context.setLineDash([3, 5]);
    context.strokeStyle = state.mechanisms.memory ? "rgba(110,155,150,0.7)" : "rgba(236,236,232,0.28)";
    context.lineWidth = 1.4;
    context.stroke();
    context.setLineDash([]);

    if (state.mechanisms.memory && state.recall) {
      spline(context, starPoints(state.recall.latent, radius, 0.38));
      context.strokeStyle = `rgba(110,155,150,${0.35 + 0.4 * clamp(state.recall.similarity, 0, 1)})`;
      context.lineWidth = 1.6;
      context.stroke();
    }

    const field = starPoints(this.display, radius);
    spline(context, field);
    context.fillStyle = `rgba(232,213,154,${0.14 + coherence * 0.16})`;
    context.fill();
    const flashing = this.flash > 0.2 && state.mechanisms.projection;
    context.strokeStyle = flashing ? "#f4f1ea" : "#e8d59a";
    context.lineWidth = 2.75;
    context.shadowColor = flashing ? "rgba(255,255,255,0.85)" : "rgba(232,210,150,0.85)";
    context.shadowBlur = 22;
    context.stroke();
    context.shadowBlur = 0;

    for (let i = 0; i < AXES; i += 1) {
      const point = field[i];
      const magnitude = Math.abs(state.update[i] ?? 0);
      if (magnitude >= 0.03) {
        const angle = (i / AXES) * TAU - Math.PI / 2;
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + Math.cos(angle) * magnitude * radius * 0.42,
          point.y + Math.sin(angle) * magnitude * radius * 0.42);
        context.strokeStyle = "rgba(196,165,116,0.85)";
        context.lineWidth = 2;
        context.stroke();
      }
      context.beginPath();
      context.arc(point.x, point.y, 3.2, 0, TAU);
      context.fillStyle = "#f3ead2";
      context.fill();
    }

    if (state.mechanisms.summaries) {
      for (const summary of state.summaries) {
        const point = centroid(starPoints(summary.latent, radius));
        context.beginPath();
        context.arc(point.x, point.y, 2.6, 0, TAU);
        context.fillStyle = "rgb(142,160,184)";
        context.fill();
      }
    }

    for (const mote of this.motes) {
      context.beginPath();
      context.arc(Math.cos(mote.angle) * mote.radius * radius * 1.28,
        Math.sin(mote.angle) * mote.radius * radius * 1.28, 1.6, 0, TAU);
      context.fillStyle = state.mechanisms.noise
        ? `rgba(196,137,122,${mote.life * 0.9})`
        : `rgba(197,204,214,${mote.life * 0.25})`;
      context.fill();
    }

    if (this.flash > 0.02 && state.mechanisms.projection) {
      context.beginPath();
      context.arc(0, 0, radius * (0.72 + (1 - this.flash) * 0.35), 0, TAU);
      context.strokeStyle = `rgba(243,234,210,${this.flash * 0.75})`;
      context.lineWidth = 3;
      context.stroke();
    }
    if (this.pulse) {
      const life = 1 - (now - this.pulse.started) / 420;
      if (life <= 0) this.pulse = undefined;
      else {
        context.beginPath();
        context.arc(this.pulse.x, this.pulse.y, 10 + (1 - life) * 18, 0, TAU);
        context.strokeStyle = `rgba(243,234,210,${life * 0.75})`;
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
    context.restore();
  }
}
