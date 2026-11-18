import React, { useEffect, useRef } from "react";
import type { PlotLayout, TerminalParams, ViewportState } from "./terminal-types";
import { clamp, type SimulationState } from "./terminal-simulation";
import { initAudio, resumeAudioIfNeeded } from "./terminal-audio";

interface GesturesParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewportRef: React.MutableRefObject<ViewportState>;
  dimsRef: React.MutableRefObject<{ w: number; h: number; dpr: number; axisW: number; timeH: number }>;
  simRef: React.MutableRefObject<SimulationState>;
  setHover: (pos: { px: number; py: number } | null) => void;
  onParamChange: <K extends keyof TerminalParams>(key: K, val: TerminalParams[K]) => void;
  addToast: (msg: string, kind?: "warn" | "danger" | "ok") => void;
  setFocusPrice: (focus: { price: number; until: number } | null) => void;
}

export function useTerminalGestures({
  canvasRef, viewportRef, dimsRef, simRef, setHover, onParamChange, addToast, setFocusPrice,
}: GesturesParams) {
  const dragRef = useRef<{ x: number; center: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    initAudio();
    resumeAudioIfNeeded();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.nativeEvent.offsetX, center: viewportRef.current.tCenter };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = viewportRef.current;
    const { w, axisW } = dimsRef.current;
    const bw = (w - axisW - 12) / v.visible;
    if (dragRef.current) {
      const dx = e.nativeEvent.offsetX - dragRef.current.x;
      if (Math.abs(dx) > 3) onParamChange("follow", false);
      // Drag and swipe track the finger 1:1; easing is only for zoom, follow and focus moves.
      v.tCenter = dragRef.current.center - dx / bw;
      v.center = v.tCenter;
    }
    setHover({ px: e.nativeEvent.offsetX, py: e.nativeEvent.offsetY });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  const panByWheel = (deltaX: number): void => {
    const v = viewportRef.current;
    const { w, axisW } = dimsRef.current;
    v.tCenter += deltaX / ((w - axisW - 12) / v.visible);
    v.center = v.tCenter;
    onParamChange("follow", false);
  };

  const zoomByWheel = (e: WheelEvent): void => {
    const v = viewportRef.current;
    const { w, axisW } = dimsRef.current;
    const plotW = w - axisW - 12;
    const bw = plotW / v.visible;
    const px = clamp(e.offsetX, 8, plotW + 8);
    const anchor = (v.center - v.visible / 2) + (px - 8) / bw;
    v.tVisible = clamp(v.tVisible * Math.exp(e.deltaY * 0.0012), 40, 240);
    v.tCenter = anchor - ((px - 8) / plotW) * v.tVisible + v.tVisible / 2;
    onParamChange("zoom", Math.round(v.tVisible));
    onParamChange("follow", false);
  };

  // Trackpad: two-finger horizontal swipe pans, pinch (ctrl+wheel) and vertical scroll zoom.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const isHorizontalSwipe = !e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (isHorizontalSwipe) panByWheel(e.deltaX);
    else zoomByWheel(e);
  };
  const wheelRef = useRef(onWheel);
  useEffect(() => {
    wheelRef.current = onWheel;
  });

  // React attaches wheel listeners as passive, so preventDefault (needed to stop page scroll/zoom) only works natively.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const listener = (e: WheelEvent) => wheelRef.current(e);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, [canvasRef]);

  const resetView = () => {
    viewportRef.current.tVisible = 96;
    viewportRef.current.tCenter = simRef.current.playhead - 96 * 0.34;
    onParamChange("zoom", 96);
    onParamChange("follow", true);
    setFocusPrice(null);
    addToast("View reset", "ok");
  };

  return { dragRef, onPointerDown, onPointerMove, onPointerUp, resetView };
}
