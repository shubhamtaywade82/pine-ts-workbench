import { describe, expect, it } from "bun:test";
import type { LongSide } from "./option-filter";
import { ALERT_COOLDOWN_MS, INITIAL_VERDICT_STATE, nextVerdictState, type VerdictState } from "./verdict-alerts";

const MIN = 60_000;

/** Feeds readings in order and returns every alert with the time it fired. */
const run = (readings: readonly (readonly [number, LongSide])[]): { alerts: [number, LongSide][]; state: VerdictState } => {
  let state = INITIAL_VERDICT_STATE;
  const alerts: [number, LongSide][] = [];
  for (const [at, side] of readings) {
    const next = nextVerdictState(state, side, at);
    state = next.state;
    if (next.alert !== undefined) alerts.push([at, next.alert]);
  }
  return { alerts, state };
};

describe("nextVerdictState", () => {
  it("does not alert on the first reading, which is only the baseline", () => {
    expect(run([[0, "CE"]]).alerts).toEqual([]);
  });

  it("does not alert while the verdict stays the same", () => {
    expect(run([[0, "NONE"], [10_000, "NONE"], [20_000, "NONE"]]).alerts).toEqual([]);
  });

  it("alerts once a new verdict has held for two readings", () => {
    expect(run([[0, "NONE"], [10_000, "CE"], [20_000, "CE"]]).alerts).toEqual([[20_000, "CE"]]);
  });

  it("ignores a one-reading flicker", () => {
    expect(run([[0, "NONE"], [10_000, "CE"], [20_000, "NONE"], [30_000, "NONE"]]).alerts).toEqual([]);
  });

  it("restarts the count when the candidate changes", () => {
    expect(run([[0, "NONE"], [10_000, "CE"], [20_000, "PE"], [30_000, "CE"], [40_000, "CE"]]).alerts).toEqual([[40_000, "CE"]]);
  });

  it("does not alert twice for the same verdict", () => {
    const { alerts } = run([[0, "NONE"], [1, "CE"], [2, "CE"], [3, "CE"], [4, "CE"]]);
    expect(alerts).toHaveLength(1);
  });

  it("holds a confirmed change back during the cooldown, then announces it if it still holds", () => {
    const { alerts } = run([
      [0, "NONE"], [10_000, "CE"], [20_000, "CE"], // alert at 20s
      [30_000, "PE"], [40_000, "PE"], // confirmed, but inside the cooldown
      [20_000 + ALERT_COOLDOWN_MS + 10_000, "PE"], // cooldown over, still PE
    ]);
    expect(alerts).toEqual([[20_000, "CE"], [20_000 + ALERT_COOLDOWN_MS + 10_000, "PE"]]);
  });

  it("drops a change that reverted during the cooldown, so nothing stale is announced", () => {
    const { alerts } = run([
      [0, "NONE"], [10_000, "CE"], [20_000, "CE"],
      [30_000, "PE"], [40_000, "PE"],
      [50_000, "CE"], // back to what the user was told
      [20_000 + ALERT_COOLDOWN_MS + 10_000, "CE"],
    ]);
    expect(alerts).toEqual([[20_000, "CE"]]);
  });

  it("announces a move to no long options as well, since that is when to stand aside", () => {
    expect(run([[0, "CE"], [10 * MIN, "NONE"], [10 * MIN + 1_000, "NONE"]]).alerts).toEqual([[10 * MIN + 1_000, "NONE"]]);
  });
});
