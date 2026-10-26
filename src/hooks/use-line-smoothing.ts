"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ISeriesApi, LineData, Time, WhitespaceData } from "lightweight-charts";
import { SMOOTHING_TAU_MS } from "@/hooks/use-candle-series";

const SETTLE_EPSILON = 1e-7;

export type OverlayPoint = LineData<Time> | WhitespaceData<Time>;

interface Tween {
  readonly time: Time;
  shown: number;
  target: number;
}

/** Only the forming bar's value changed: same points, same last time. */
const isLastValueUpdate = (previous: readonly OverlayPoint[] | undefined, next: readonly OverlayPoint[]): boolean => {
  if (previous === undefined || previous.length !== next.length || next.length < 2) return false;
  const prevLast = previous.at(-1)!;
  const nextLast = next.at(-1)!;
  if (!("value" in prevLast) || !("value" in nextLast)) return false;
  const prevPrev = previous.at(-2)!;
  const nextPrev = next.at(-2)!;
  if (!("value" in prevPrev) || !("value" in nextPrev)) return false;
  return prevLast.time === nextLast.time && prevPrev.value === nextPrev.value;
};

/**
 * Indicator lines with the candle's smoothing: when a live tick only moves a
 * line's last point, the point eases there (same time constant as the forming
 * candle) instead of jumping; any other change replaces the data at once.
 */
export function useLineSmoothing() {
  const shownData = useRef(new WeakMap<ISeriesApi<"Line">, readonly OverlayPoint[]>());
  const tweens = useRef(new Map<ISeriesApi<"Line">, Tween>());
  const frame = useRef<number | null>(null);

  const animate = useCallback(() => {
    if (frame.current !== null) return;
    let lastFrameAt = performance.now();
    const step = (now: number) => {
      const k = 1 - Math.exp(-(now - lastFrameAt) / SMOOTHING_TAU_MS);
      lastFrameAt = now;
      for (const [series, tween] of tweens.current) {
        tween.shown += (tween.target - tween.shown) * k;
        const isSettled = Math.abs(tween.target - tween.shown) <= Math.abs(tween.target) * SETTLE_EPSILON;
        series.update({ time: tween.time, value: isSettled ? tween.target : tween.shown });
        if (isSettled) tweens.current.delete(series);
      }
      frame.current = tweens.current.size > 0 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  /** `series.setData(data)`, except a moved last point eases to its new value. */
  return useCallback((series: ISeriesApi<"Line">, data: readonly OverlayPoint[]) => {
    const previous = shownData.current.get(series);
    shownData.current.set(series, data);
    const last = data.at(-1);
    if (last === undefined || !("value" in last) || !isLastValueUpdate(previous, data)) {
      tweens.current.delete(series);
      series.setData([...data]);
      return;
    }
    const running = tweens.current.get(series);
    const prevVal = "value" in previous!.at(-1)! ? (previous!.at(-1) as LineData<Time>).value : last.value;
    tweens.current.set(series, { time: last.time, shown: running?.shown ?? prevVal, target: last.value });
    animate();
  }, [animate]);
}
