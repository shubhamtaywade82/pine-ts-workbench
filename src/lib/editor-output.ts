import type { Bar, ScriptDrawings } from "@nemesis-oss/pine-ts";
import type { ChartOverlay } from "@/components/chart/chart-workbench";
import type { ChartDrawing } from "@/components/chart/script-drawings-primitive";

/** Pine Editor output (per-bar values and bar-indexed drawings) → chart-ready, time-based data. */

/** Plot values per editor bar → chart overlays; constant plots become dashed levels. */
export const toEditorOverlays = (
  results: Record<string, Array<number | undefined>>,
  plots: { id: string; color: string; kind: string }[],
  bars: readonly Bar[],
): ChartOverlay[] => plots.map((plot) => {
  const values = results[plot.id] ?? [];
  // na stays as a whitespace point, so the line breaks there as in Pine instead of bridging the gap.
  const data = bars.map((bar, i) => {
    const value = values[i];
    return { time: bar.time, value: value === undefined || Number.isNaN(value) ? undefined : value };
  });
  return {
    instanceId: `editor:${plot.id}`,
    indicatorId: `editor.${plot.id}`,
    indicatorName: `Custom (${plot.id})`,
    color: plot.color,
    isLevel: plot.kind === "hline",
    data,
  };
});

export const NO_DRAWINGS: ChartDrawing[] = [];

/** Script drawings use bar indices; the chart needs the times of the bars the editor ran on. */
export const toChartDrawings = (drawings: ScriptDrawings, bars: readonly Bar[]): ChartDrawing[] => {
  if (bars.length === 0) return [];
  return [...smcDrawings(drawings, bars), ...shapeDrawings(drawings, bars)];
};

const smcDrawings = (drawings: ScriptDrawings, bars: readonly Bar[]): ChartDrawing[] => {
  const time = (index: number) => bars[Math.max(0, Math.min(index, bars.length - 1))]?.time;
  const resolved: ChartDrawing[] = [];
  for (const line of drawings.lines) {
    if (line.fromBar < 0 || line.toBar < 0 || Number.isNaN(line.price)) continue;
    const [from, to] = [time(line.fromBar), time(line.toBar)];
    if (from === undefined || to === undefined) continue;
    const isBullish = line.direction === "bullish";
    // BOS dashed, CHoCH solid, as in the SMC Confluence Engine.
    resolved.push({ kind: "line", from, to, price: line.price, text: line.text, isBullish, isDashed: line.text === "BOS" });
  }
  for (const box of drawings.boxes) {
    if (box.fromBar < 0 || box.toBar < 0 || Number.isNaN(box.top) || Number.isNaN(box.bottom)) continue;
    const [from, to] = [time(box.fromBar), time(box.toBar)];
    if (from === undefined || to === undefined) continue;
    resolved.push({ kind: "box", from, to, top: box.top, bottom: box.bottom, isBullish: box.direction === "bullish", text: box.text });
  }
  return resolved;
};


/** Generic shapes may sit on future bars (Pine's `bar_index + 20`): extrapolate their time by the bar step. */
const shapeDrawings = (drawings: ScriptDrawings, bars: readonly Bar[]): ChartDrawing[] => {
  const last = bars.length - 1;
  const step = last > 0 ? bars[last]!.time - bars[last - 1]!.time : 60_000;
  const time = (index: number) => (index <= last ? bars[Math.max(0, Math.round(index))]!.time : bars[last]!.time + (index - last) * step);
  const resolved: ChartDrawing[] = [
    ...drawings.bgcolors.map(({ bar, color }) => ({ kind: "bgcolor" as const, time: time(bar), color })),
    ...drawings.barcolors.map(({ bar, color }) => ({ kind: "barcolor" as const, time: time(bar), color })),
  ];
  for (const shape of drawings.shapes) {
    if (shape.kind === "line") resolved.push({ ...shape, kind: "shape-line", from: time(shape.x1), to: time(shape.x2) });
    else if (shape.kind === "box") resolved.push({ ...shape, kind: "shape-box", from: time(shape.left), to: time(shape.right) });
    else resolved.push({ ...shape, time: time(shape.x) });
  }
  if (drawings.table !== undefined) resolved.push({ kind: "table", table: drawings.table });
  return resolved;
};
