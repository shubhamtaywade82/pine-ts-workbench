/** Decimal places needed to show multiples of `tick` exactly (0.01 -> 2, 0.001 -> 3). */
export const tickDecimals = (tick: number): number =>
  Math.min(8, Math.max(0, Math.ceil(-Math.log10(tick) - 1e-9)));

export const fmtP = (p: number, decimals = 2): string => p.toFixed(decimals);

export const fmtS = (s: number): string =>
  s >= 1000 ? (s / 1000).toFixed(1) + "k" : Math.round(s) + "";

export const fmtT = (t: number): string => {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

export const fmtAge = (bars: number, tf: number): string => {
  const m = bars * tf;
  if (m < 1) return "<1m";
  if (m < 60) return m + "m";
  return (m / 60).toFixed(1) + "h";
};

export function hexRGB(h: string): [number, number, number] {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

export function rgba(h: string, a: number): string {
  const [r, g, b] = hexRGB(h);
  return `rgba(${r},${g},${b},${a})`;
}

export function mixHex(h1: string, h2: string, t: number): string {
  const a = hexRGB(h1);
  const b = hexRGB(h2);
  const mix = (c0: number, c1: number) => Math.round(c0 + (c1 - c0) * t);
  return "#" + [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

export function drawRoundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.arcTo(x + w, y, x + w, y + h, rad);
  c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad);
  c.arcTo(x, y, x + w, y, rad);
  c.closePath();
}
