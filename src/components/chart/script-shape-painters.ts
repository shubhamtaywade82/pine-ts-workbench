import type { ScriptTable } from "@nemesis-oss/pine-ts";
import type { ChartDrawing } from "./script-drawings-primitive";

/** Canvas painters for generic script shapes (Pine line/box/label/table/bgcolor). */

export type Projection = {
  readonly x: (ms: number) => number | null;
  readonly y: (price: number) => number | null;
  readonly barWidth: number;
};

// Pine's defaults: blue lines and boxes, light label text, a dark dashboard.
const DEFAULT_LINE = "#2962ff";
const DEFAULT_TEXT = "#d1d4dc";
const LINE_HEIGHT_PX = 13;
const LABEL_PAD_PX = 4;
const TABLE_FONT = "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
const TABLE_ROW_PX = 18;
const TABLE_MARGIN_PX = 8;
// The legend occupies the pane's top-left corner.
const LEGEND_CLEARANCE_PX = 24;
const DASHES = { solid: [], dashed: [5, 4], dotted: [1, 3] } as const;

export interface PlacedBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: PlacedBox, b: PlacedBox): boolean =>
  !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);

export const LABEL_SIZES: Record<string, { font: string; lineHeight: number; pad: number }> = {
  tiny: { font: "9px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif", lineHeight: 11, pad: 2 },
  small: { font: "10px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif", lineHeight: 12, pad: 3 },
  normal: { font: "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif", lineHeight: 14, pad: 4 },
  large: { font: "13px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif", lineHeight: 16, pad: 5 },
  huge: { font: "16px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif", lineHeight: 20, pad: 6 },
  auto: { font: "11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif", lineHeight: 14, pad: 4 },
};

export const resolveLabelBox = (initial: PlacedBox, position: string, placed: readonly PlacedBox[]): PlacedBox => {
  const box = { ...initial };
  const height = initial.bottom - initial.top;
  for (let iter = 0; iter < 5; iter++) {
    const collidee = placed.find((p) => overlaps(box, p));
    if (!collidee) break;
    if (position === "above") {
      box.top = collidee.top - height - 2;
      box.bottom = box.top + height;
    } else {
      box.top = collidee.bottom + 2;
      box.bottom = box.top + height;
    }
  }
  return box;
};

export const paintBgcolor = (context: CanvasRenderingContext2D, { x, barWidth }: Projection, bg: Extract<ChartDrawing, { kind: "bgcolor" }>, height: number): void => {
  const center = x(bg.time);
  if (center === null) return;
  context.fillStyle = bg.color;
  context.fillRect(center - barWidth / 2, 0, barWidth, height);
};

export const paintShapeLine = (context: CanvasRenderingContext2D, { x, y }: Projection, line: Extract<ChartDrawing, { kind: "shape-line" }>): void => {
  const [x1, x2, y1, y2] = [x(line.from), x(line.to), y(line.y1), y(line.y2)];
  if (x1 === null || x2 === null || y1 === null || y2 === null) return;
  context.strokeStyle = line.color ?? DEFAULT_LINE;
  context.lineWidth = line.width ?? 1;
  context.setLineDash([...DASHES[line.style ?? "solid"]]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.setLineDash([]);
};

export const paintShapeBox = (context: CanvasRenderingContext2D, { x, y }: Projection, box: Extract<ChartDrawing, { kind: "shape-box" }>): void => {
  const [x1, x2, top, bottom] = [x(box.from), x(box.to), y(box.top), y(box.bottom)];
  if (x1 === null || x2 === null || top === null || bottom === null) return;
  const [left, upper] = [Math.min(x1, x2), Math.min(top, bottom)];
  const [width, height] = [Math.abs(x2 - x1), Math.max(Math.abs(bottom - top), 1)];
  context.fillStyle = box.fill ?? `${DEFAULT_LINE}33`;
  context.fillRect(left, upper, width, height);
  if (box.border === undefined) return;
  context.strokeStyle = box.border;
  context.lineWidth = 1;
  context.strokeRect(left, upper, width, height);
};

/** Text blocks anchored at (x, y) with font sizing and collision separation. */
export const paintLabels = (
  context: CanvasRenderingContext2D,
  projection: Projection,
  labels: readonly Extract<ChartDrawing, { kind: "label" }>[],
): void => {
  const placed: PlacedBox[] = [];
  for (const label of labels) {
    const [px, py] = [projection.x(label.time), projection.y(label.y)];
    if (px === null || py === null) continue;
    const style = LABEL_SIZES[label.size ?? "normal"] ?? LABEL_SIZES.normal!;
    context.font = style.font;
    const lines = label.text.split("\n");
    const width = Math.max(...lines.map((l) => context.measureText(l).width)) + style.pad * 2;
    const height = lines.length * style.lineHeight + style.pad;
    const pos = label.position ?? "center";
    const left = pos === "left" ? px - width : pos === "right" ? px : px - width / 2;
    const top = pos === "above" ? py - height - style.pad : pos === "below" ? py + style.pad : py - height / 2;
    const resolved = resolveLabelBox({ left, top, right: left + width, bottom: top + height }, pos, placed);
    placed.push(resolved);

    if (label.background !== undefined) {
      context.fillStyle = label.background;
      context.fillRect(resolved.left, resolved.top, width, height);
    }
    context.fillStyle = label.color ?? DEFAULT_TEXT;
    context.textAlign = "left";
    context.textBaseline = "top";
    lines.forEach((line, i) =>
      context.fillText(line, resolved.left + style.pad, resolved.top + style.pad / 2 + i * style.lineHeight),
    );
  }
};

export const paintLabel = (
  context: CanvasRenderingContext2D,
  projection: Projection,
  label: Extract<ChartDrawing, { kind: "label" }>,
): void => paintLabels(context, projection, [label]);

/** The script's dashboard in a pane corner; columns size to their widest cell. */
export const paintTable = (context: CanvasRenderingContext2D, table: ScriptTable, size: { width: number; height: number }): void => {
  context.font = TABLE_FONT;
  const columns = Math.max(...table.rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(...table.rows.map((row) => context.measureText(row[c]?.text ?? "").width)) + LABEL_PAD_PX * 3);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  const isRight = table.position.endsWith("right");
  const isBottom = table.position.startsWith("bottom");
  const left = isRight ? size.width - totalWidth - TABLE_MARGIN_PX : TABLE_MARGIN_PX;
  const top = isBottom ? size.height - table.rows.length * TABLE_ROW_PX - TABLE_MARGIN_PX  : TABLE_MARGIN_PX + (isRight ? 0 : LEGEND_CLEARANCE_PX);
  context.textAlign = "left";
  context.textBaseline = "middle";
  table.rows.forEach((row, r) => {
    let cellLeft = left;
    widths.forEach((width, c) => {
      const cell = row[c];
      context.fillStyle = cell?.bg ?? "#131722e6";
      context.fillRect(cellLeft, top + r * TABLE_ROW_PX, width, TABLE_ROW_PX);
      context.fillStyle = cell?.color ?? DEFAULT_TEXT;
      context.fillText(cell?.text ?? "", cellLeft + LABEL_PAD_PX, top + r * TABLE_ROW_PX + TABLE_ROW_PX / 2);
      cellLeft += width;
    });
  });
};
