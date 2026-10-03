import { useEffect, useRef } from "react";
import FieldJs from "./vendor/field.js";
import RendererJs from "./vendor/renderer.js";
import { format, rebuildSimField, sim, useLab } from "./store";

const Field: any = FieldJs;
const Renderer: any = RendererJs;

type RendererHandle = {
  view: string;
  scalarMode: string;
  layers: Record<string, boolean>;
  yaw: number;
  pitch: number;
  selected: { x: number; y: number } | null;
};

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RendererHandle | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
    moved: boolean;
  } | null>(null);

  const rev = useLab((s) => s.rev);
  const view = useLab((s) => s.view);
  const scalarMode = useLab((s) => s.scalarMode);
  const layers = useLab((s) => s.layers);
  const selectedPoint = useLab((s) => s.selectedPoint);
  const yaw = useLab((s) => s.yaw);
  const pitch = useLab((s) => s.pitch);
  const setFps = useLab((s) => s.setFps);
  const setOrbit = useLab((s) => s.setOrbit);
  const pickPoint = useLab((s) => s.pickPoint);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = Renderer.createRenderer(canvas) as RendererHandle;
    rendererRef.current = renderer;
    sim.dirty = true;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const current = rendererRef.current;
      if (current && sim.dirty) {
        Renderer.render(current, sim.field, sim.state, sim.projection, sim.peerState);
        sim.dirty = false;
        frames += 1;
      }
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [setFps]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => rebuildSimField());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    Renderer.setView(renderer, view);
    Renderer.setScalarMode(renderer, scalarMode);
    for (const [layer, enabled] of Object.entries(layers)) {
      Renderer.setLayer(renderer, layer, enabled);
    }
    renderer.yaw = yaw;
    renderer.pitch = pitch;
    renderer.selected = selectedPoint;
    sim.dirty = true;
  }, [rev, view, scalarMode, layers, yaw, pitch, selectedPoint]);

  const sample = selectedPoint ? Field.sampleAt(sim.field, selectedPoint.x, selectedPoint.y) : null;

  return (
    <div className="viewport-wrap" id="viewport" ref={wrapRef} tabIndex={-1}>
      <canvas
        id="fieldCanvas"
        ref={canvasRef}
        role="img"
        aria-label="Memory Weather regime viewport; keyboard forcing is available in the X and Y controls"
        onPointerDown={(event) => {
          const renderer = rendererRef.current;
          if (!renderer) return;
          pointerRef.current = {
            x: event.clientX,
            y: event.clientY,
            yaw: renderer.yaw,
            pitch: renderer.pitch,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pointer = pointerRef.current;
          const renderer = rendererRef.current;
          if (!pointer || !renderer || renderer.view !== "terrain") return;
          const dx = event.clientX - pointer.x;
          const dy = event.clientY - pointer.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
          setOrbit(pointer.yaw + dx * 0.009, clamp(pointer.pitch + dy * 0.006, 0.35, 1.28));
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          const renderer = rendererRef.current;
          if (pointer && renderer && !pointer.moved && renderer.view !== "terrain") {
            const point = Renderer.screenToField(renderer, sim.field, event.clientX, event.clientY);
            pickPoint(point, Field.sampleAt(sim.field, point.x, point.y));
          }
          pointerRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
        }}
        onWheel={(event) => {
          const renderer = rendererRef.current;
          if (!renderer || renderer.view !== "terrain") return;
          event.preventDefault();
          setOrbit(renderer.yaw, clamp(renderer.pitch + Math.sign(event.deltaY) * 0.05, 0.35, 1.28));
        }}
      />
      {view === "terrain" ? (
        <div className="orbit-controls" role="group" aria-label="Terrain orbit controls">
          <button type="button" aria-label="Rotate terrain left" onClick={() => setOrbit(yaw - 0.12, pitch)}>from</button>
          <button type="button" aria-label="Tilt terrain up" onClick={() => setOrbit(yaw, clamp(pitch - 0.08, 0.35, 1.28))}>Up</button>
          <button type="button" aria-label="Tilt terrain down" onClick={() => setOrbit(yaw, clamp(pitch + 0.08, 0.35, 1.28))}>Down</button>
          <button type="button" aria-label="Rotate terrain right" onClick={() => setOrbit(yaw + 0.12, pitch)}>to</button>
        </div>
      ) : null}
      <div className="canvas-legend" aria-hidden="true">
        <span>low</span>
        <i />
        <span>high</span>
      </div>
      {selectedPoint && sample ? (
        <div className="selection-readout">
          forcing target ({selectedPoint.x.toFixed(2)}, {selectedPoint.y.toFixed(2)})  /  coherence{" "}
          {format(sample.coherence)}  /  projection margin {format(sample.projectionMargin)}  /  next tick
        </div>
      ) : null}
    </div>
  );
}

function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value));
}
