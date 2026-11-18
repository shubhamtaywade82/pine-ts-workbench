import { NORMAL, type RayHit } from "./terminal-types";
import { fmtAge, fmtP, fmtS } from "./terminal-formatters";

export function exportCanvasAsPng(
  sc: HTMLCanvasElement | null,
  oc: HTMLCanvasElement | null,
  symbol: string,
  tf: number,
  seed: number,
): void {
  if (!sc || !oc) return;
  const out = document.createElement("canvas");
  out.width = sc.width;
  out.height = sc.height;
  const ctx = out.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#04070F";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(sc, 0, 0);
  ctx.drawImage(oc, 0, 0);
  const a = document.createElement("a");
  a.download = `nemesis-smc-${symbol.toLowerCase()}-${tf}m-seed${seed}.png`;
  a.href = out.toDataURL("image/png");
  a.click();
}

export function findHoveredRay(
  hover: { px: number; py: number } | null,
  rayHits: RayHit[],
): RayHit | null {
  if (!hover) return null;
  return rayHits.find((r) => Math.abs(hover.py - r.y) < 6 && hover.px >= r.x0 - 4 && hover.px <= r.x1) || null;
}

export function formatRayTooltip(ray: RayHit, floor: number, tf: number): { title: string; meta: string; col: string } {
  return {
    title: `${fmtP(ray.price)} · ${fmtS(ray.size)} resting`,
    meta: `${ray.side === "bid" ? "Big Buyers" : "Big Sellers"} · ${(ray.size / NORMAL).toFixed(1)}× normal · waiting ${fmtAge(floor - ray.born, tf)}`,
    col: ray.side === "bid" ? "var(--bid)" : "var(--ask)",
  };
}
