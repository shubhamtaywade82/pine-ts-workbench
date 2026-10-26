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
  const data: { time: number; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const value = values[i];
    if (value === undefined || Number.isNaN(value)) continue;
    data.push({ time: bars[i]!.time, value });
  }
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
  const time = (index: number) => bars[index]?.time;
  const resolved: ChartDrawing[] = [];
  for (const line of drawings.lines) {
    const [from, to] = [time(line.fromBar), time(line.toBar)];
    if (from === undefined || to === undefined) continue;
    const isBullish = line.direction === "bullish";
    // BOS dashed, CHoCH solid, as in the SMC Confluence Engine.
    resolved.push({ kind: "line", from, to, price: line.price, text: line.text, isBullish, isDashed: line.text === "BOS" });
  }
  for (const box of drawings.boxes) {
    const [from, to] = [time(box.fromBar), time(box.toBar)];
    if (from === undefined || to === undefined) continue;
    resolved.push({ kind: "box", from, to, top: box.top, bottom: box.bottom, isBullish: box.direction === "bullish" });
  }
  return resolved;
};

