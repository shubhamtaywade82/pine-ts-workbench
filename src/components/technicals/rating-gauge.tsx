"use client";

import type { Rating } from "@/lib/technical-ratings";

const SELL = "#f23645";
const NEUTRAL = "#b2b5be";
const BUY = "#2962ff";
// Five arcs across the half circle: strong sell → strong buy.
const SEGMENTS = [SELL, SELL, NEUTRAL, BUY, BUY];
const GAP_DEG = 6;

const polar = (degrees: number, radius: number) => {
  const radians = (Math.PI * degrees) / 180;
  return { x: 50 - radius * Math.cos(radians), y: 50 - radius * Math.sin(radians) };
};

const arc = (from: number, to: number, radius: number) => {
  const start = polar(from, radius);
  const end = polar(to, radius);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
};

/** TradingView's rating speedometer: score -1 (left) to 1 (right), with Sell/Neutral/Buy counts below. */
export function RatingGauge({ title, score, rating, counts, isLarge = false }: {
  title: string;
  score: number;
  rating: Rating;
  counts: { sell: number; neutral: number; buy: number };
  isLarge?: boolean;
}) {
  const needle = polar(((score + 1) / 2) * 180, 30);
  const span = 180 / SEGMENTS.length;
  return (
    <div className="flex w-full max-w-[180px] flex-col items-center gap-1">
      <svg viewBox="0 0 100 56" className={isLarge ? "w-36 sm:w-40" : "w-24 sm:w-28"} role="img" aria-label={`${title}: ${rating}`}>
        {SEGMENTS.map((color, i) => (
          <path key={i} d={arc(i * span + GAP_DEG / 2, (i + 1) * span - GAP_DEG / 2, 42)} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" />
        ))}
        <line x1="50" y1="50" x2={needle.x} y2={needle.y} stroke={NEUTRAL} strokeWidth="3" strokeLinecap="round" />
        <circle cx="50" cy="50" r="3" fill={NEUTRAL} />
      </svg>
      <span className="text-xs font-semibold">{title}</span>
      <span className={`font-semibold ${isLarge ? "text-base sm:text-lg" : "text-sm sm:text-base"}`}>{rating}</span>
      <div className="grid w-full grid-cols-3 gap-1 rounded-md bg-muted px-1.5 py-1 text-center text-[10px] sm:text-[11px]">
        <span>Sell<br /><b className="text-xs sm:text-sm">{counts.sell}</b></span>
        <span>Neutral<br /><b className="text-xs sm:text-sm">{counts.neutral}</b></span>
        <span>Buy<br /><b className="text-xs sm:text-sm">{counts.buy}</b></span>
      </div>
    </div>
  );
}
