import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";
import type { Bar } from "@nemesis-oss/pine-ts";
import { UserDrawingsPrimitive } from "@/components/chart/user-drawings-primitive";
import type { DrawingPoint, DrawingToolType, UserDrawing } from "@/lib/user-drawings";

function resolvePoint(
  param: MouseEventParams<Time>,
  chart: IChartApi,
  candle: ISeriesApi<"Candlestick">,
  bars: readonly Bar[],
  intervalMs: number,
): DrawingPoint | null {
  if (!param.point) return null;
  const price = candle.coordinateToPrice(param.point.y);
  if (price === null) return null;

  let time: number | null = null;
  if (param.time !== undefined) {
    time = Number(param.time) * 1000;
  } else {
    const timeScale = chart.timeScale();
    const logical = param.logical ?? timeScale.coordinateToLogical(param.point.x);
    if (logical !== null && bars.length > 0) {
      const lastBar = bars[bars.length - 1]!;
      const diffBars = logical - (bars.length - 1);
      time = lastBar.time + diffBars * intervalMs;
    }
  }

  if (time === null) return null;
  return { time, price: Number(price) };
}

export function useChartDrawings(
  chartRef: RefObject<IChartApi | null>,
  candlestickRef: RefObject<ISeriesApi<"Candlestick"> | null>,
  bars: readonly Bar[],
  intervalMs: number,
) {
  const [activeTool, setActiveTool] = useState<DrawingToolType>("cursor");
  const [drawings, setDrawings] = useState<readonly UserDrawing[]>([]);
  const [draftPoint, setDraftPoint] = useState<DrawingPoint | null>(null);
  const primitiveRef = useRef<{ series: ISeriesApi<"Candlestick">; primitive: UserDrawingsPrimitive } | null>(null);

  // Attach primitive to series on mount or series change.
  useEffect(() => {
    const candle = candlestickRef.current;
    if (candle === null) return;
    if (primitiveRef.current?.series !== candle) {
      const primitive = new UserDrawingsPrimitive();
      candle.attachPrimitive(primitive);
      primitiveRef.current = { series: candle, primitive };
    }
    const { primitive } = primitiveRef.current;
    primitive.setDrawings(drawings);
    primitive.setIntervalMs(intervalMs);
  }, [candlestickRef, drawings, intervalMs]);

  const clearDrawings = useCallback(() => {
    setDrawings([]);
    setDraftPoint(null);
    primitiveRef.current?.primitive.setDraft(null);
    primitiveRef.current?.primitive.setDrawings([]);
  }, []);

  // Escape key cancels in-progress draft and resets to cursor.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraftPoint(null);
        primitiveRef.current?.primitive.setDraft(null);
        setActiveTool("cursor");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Subscribe to chart clicks for placing drawing endpoints.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candlestickRef.current;
    if (chart === null || candle === null || activeTool === "cursor") return;

    const onClick = (param: MouseEventParams<Time>) => {
      const pt = resolvePoint(param, chart, candle, bars, intervalMs);
      if (pt === null) return;

      if (activeTool === "ray") {
        setDrawings((prev) => [...prev, { id: crypto.randomUUID(), type: "ray", p1: pt, p2: pt }]);
        setActiveTool("cursor");
        return;
      }

      if (draftPoint === null) {
        setDraftPoint(pt);
      } else {
        const newDrawing: UserDrawing = { id: crypto.randomUUID(), type: activeTool, p1: draftPoint, p2: pt };
        setDrawings((prev) => [...prev, newDrawing]);
        setDraftPoint(null);
        primitiveRef.current?.primitive.setDraft(null);
        setActiveTool("cursor");
      }
    };

    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [chartRef, candlestickRef, activeTool, draftPoint, bars, intervalMs]);

  // Subscribe to crosshair movement for live draft preview.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candlestickRef.current;
    if (chart === null || candle === null || draftPoint === null || activeTool === "cursor" || activeTool === "ray") {
      return;
    }

    const onMove = (param: MouseEventParams<Time>) => {
      const pt = resolvePoint(param, chart, candle, bars, intervalMs);
      if (pt === null) return;
      primitiveRef.current?.primitive.setDraft({
        id: "draft",
        type: activeTool,
        p1: draftPoint,
        p2: pt,
      });
    };

    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [chartRef, candlestickRef, draftPoint, activeTool, bars, intervalMs]);

  return {
    activeTool,
    setActiveTool,
    drawings,
    clearDrawings,
    isDrawing: draftPoint !== null,
  };
}
