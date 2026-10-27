export const REPLAY_SPEEDS: readonly { readonly label: string; readonly ms: number }[] = [
  { label: "0.25s", ms: 250 },
  { label: "0.5s", ms: 500 },
  { label: "1s", ms: 1000 },
  { label: "2s", ms: 2000 },
];

export const DEFAULT_JUMP_BACK_BARS = 50;
export const MIN_REPLAY_BARS = 5;

export function clampReplayIndex(index: number, totalBars: number): number {
  if (totalBars <= 0) return 0;
  return Math.min(totalBars, Math.max(1, index));
}

export function initialReplayIndex(totalBars: number, jumpBack = DEFAULT_JUMP_BACK_BARS): number {
  if (totalBars <= MIN_REPLAY_BARS) return totalBars;
  return Math.max(MIN_REPLAY_BARS, totalBars - jumpBack);
}

export function stepReplayIndex(
  currentIndex: number,
  totalBars: number,
): { nextIndex: number; isDone: boolean } {
  if (currentIndex >= totalBars) {
    return { nextIndex: totalBars, isDone: true };
  }
  const nextIndex = currentIndex + 1;
  return { nextIndex, isDone: nextIndex >= totalBars };
}
