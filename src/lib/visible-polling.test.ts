import { describe, expect, it } from "bun:test";
import { startPolling, type TimerLike, type VisibilityLike } from "./visible-polling";

/** A clock the test drives by hand: nothing runs until `fire` is called. */
const fakeTimers = () => {
  const delays: number[] = [];
  let pending: (() => void) | undefined;
  const timers: TimerLike = {
    set: (callback, ms) => { delays.push(ms); pending = callback; return callback; },
    clear: (handle) => { if (pending === handle) pending = undefined; },
  };
  return {
    timers,
    delays,
    isScheduled: () => pending !== undefined,
    fire: async () => { const callback = pending; pending = undefined; callback?.(); await Promise.resolve(); await Promise.resolve(); },
  };
};

const fakeVisibility = () => {
  const listeners = new Set<() => void>();
  const state = { hidden: false };
  const visibility: VisibilityLike = {
    get hidden() { return state.hidden; },
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
  };
  return { visibility, listenerCount: () => listeners.size, setHidden: (hidden: boolean) => { state.hidden = hidden; for (const l of [...listeners]) l(); } };
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("startPolling", () => {
  it("fetches at once, then keeps the base delay while answers keep changing", async () => {
    const clock = fakeTimers();
    let calls = 0;
    const stop = startPolling({ run: async () => { calls += 1; return true; }, baseMs: 6_000, maxMs: 60_000, timers: clock.timers, visibility: fakeVisibility().visibility });
    await settle();
    await clock.fire();
    await settle();

    expect(calls).toBe(2);
    expect(clock.delays).toEqual([6_000, 6_000]);
    stop();
  });

  it("doubles the delay while nothing changes, up to the cap, and resets on a change", async () => {
    const clock = fakeTimers();
    const answers = [true, false, false, false, false, false, true];
    stopAfter(answers);
    function stopAfter(list: boolean[]): void {
      let i = 0;
      startPolling({ run: async () => list[i++] ?? false, baseMs: 6_000, maxMs: 30_000, timers: clock.timers, visibility: fakeVisibility().visibility });
    }
    for (let i = 0; i < 7; i += 1) { await settle(); await clock.fire(); }
    await settle();

    expect(clock.delays.slice(0, 7)).toEqual([6_000, 12_000, 24_000, 30_000, 30_000, 30_000, 6_000]);
  });

  it("treats a failed fetch as unchanged, so errors back off instead of hammering", async () => {
    const clock = fakeTimers();
    startPolling({ run: async () => { throw new Error("offline"); }, baseMs: 5_000, maxMs: 20_000, timers: clock.timers, visibility: fakeVisibility().visibility });
    await settle();
    await clock.fire();
    await settle();

    expect(clock.delays).toEqual([10_000, 20_000]);
  });

  it("stops scheduling while the tab is hidden and refreshes at once when it is shown", async () => {
    const clock = fakeTimers();
    const view = fakeVisibility();
    let calls = 0;
    startPolling({ run: async () => { calls += 1; return true; }, baseMs: 6_000, maxMs: 60_000, timers: clock.timers, visibility: view.visibility });
    await settle();
    expect(clock.isScheduled()).toBe(true);

    view.setHidden(true);
    expect(clock.isScheduled()).toBe(false);
    await clock.fire();
    expect(calls).toBe(1);

    view.setHidden(false);
    await settle();
    expect(calls).toBe(2);
    expect(clock.isScheduled()).toBe(true);
  });

  it("starts at the base delay again after being hidden", async () => {
    const clock = fakeTimers();
    const view = fakeVisibility();
    startPolling({ run: async () => false, baseMs: 6_000, maxMs: 60_000, timers: clock.timers, visibility: view.visibility });
    await settle();
    await clock.fire();
    await settle();
    view.setHidden(true);
    view.setHidden(false);
    await settle();

    // Two quiet polls back off to 12s then 24s; coming back resets to the base, so the next quiet poll is 12s again.
    expect(clock.delays).toEqual([12_000, 24_000, 12_000]);
  });

  it("stops for good, and drops its listener", async () => {
    const clock = fakeTimers();
    const view = fakeVisibility();
    let calls = 0;
    const stop = startPolling({ run: async () => { calls += 1; return true; }, baseMs: 6_000, maxMs: 60_000, timers: clock.timers, visibility: view.visibility });
    await settle();
    stop();
    await clock.fire();
    view.setHidden(false);
    await settle();

    expect(calls).toBe(1);
    expect(view.listenerCount()).toBe(0);
  });
});
