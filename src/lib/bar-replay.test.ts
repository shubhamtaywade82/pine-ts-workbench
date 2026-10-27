import { describe, expect, it } from "bun:test";
import {
  clampReplayIndex,
  initialReplayIndex,
  MIN_REPLAY_BARS,
  REPLAY_SPEEDS,
  stepReplayIndex,
} from "./bar-replay";

describe("bar-replay calculations", () => {
  it("clampReplayIndex bounds within 1 and totalBars", () => {
    expect(clampReplayIndex(0, 100)).toBe(1);
    expect(clampReplayIndex(50, 100)).toBe(50);
    expect(clampReplayIndex(150, 100)).toBe(100);
    expect(clampReplayIndex(10, 0)).toBe(0);
  });

  it("initialReplayIndex jumps back 50 bars by default", () => {
    expect(initialReplayIndex(200)).toBe(150);
    expect(initialReplayIndex(20)).toBe(MIN_REPLAY_BARS);
    expect(initialReplayIndex(3)).toBe(3);
  });

  it("stepReplayIndex advances one bar until end", () => {
    const step1 = stepReplayIndex(50, 100);
    expect(step1.nextIndex).toBe(51);
    expect(step1.isDone).toBe(false);

    const stepLast = stepReplayIndex(99, 100);
    expect(stepLast.nextIndex).toBe(100);
    expect(stepLast.isDone).toBe(true);

    const stepBeyond = stepReplayIndex(100, 100);
    expect(stepBeyond.nextIndex).toBe(100);
    expect(stepBeyond.isDone).toBe(true);
  });

  it("includes expected speeds", () => {
    expect(REPLAY_SPEEDS.map((s) => s.ms)).toEqual([250, 500, 1000, 2000]);
  });
});
