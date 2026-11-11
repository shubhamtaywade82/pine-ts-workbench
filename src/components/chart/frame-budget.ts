// Lightweight-charts merges repaint requests into one per frame, so the fastest animation loop sets
// the repaint rate for the whole chart — candles, script drawings, ladder and walls. One shared
// budget keeps every loop at ~30 fps together; capping a single loop does nothing.
const CHART_FRAME_MS = 1000 / 30;

/**
 * A gate over rAF timestamps: true when an animation loop may apply its frame at `now`. Every
 * callback in one browser frame gets the same timestamp, so an opened frame lets all loops through
 * (one merged repaint) and a skipped frame denies all of them (no loop can starve another).
 */
export const createFrameGate = (minFrameMs: number = CHART_FRAME_MS) => {
  let openedAt = Number.NEGATIVE_INFINITY;
  return (now: number): boolean => {
    if (now === openedAt) return true;
    if (now - openedAt < minFrameMs) return false;
    openedAt = now;
    return true;
  };
};

/** The gate every chart animation loop shares. Loops skipping a frame keep their elapsed time. */
export const claimChartFrame = createFrameGate();
