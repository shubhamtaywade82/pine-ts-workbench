import { describe, expect, it } from "bun:test";
import { summarizeChain, type RawChain } from "@/lib/option-chain";
import { changeKeyReplacer, shouldPollChain } from "./use-option-chain";

const leg = (ltp: number, oi: number) => ({ last_price: ltp, oi, previous_oi: oi, implied_volatility: 15, greeks: { gamma: 0.01, theta: -1 } });
const chain: RawChain = { lastPrice: 100, strikes: [{ strike: 100, call: leg(3, 100), put: leg(3, 200) }] };
const key = (c: RawChain, now: number): string =>
  JSON.stringify(summarizeChain(c, undefined, { expiry: "2026-11-27", now }), changeKeyReplacer);

describe("telling a changed chain from a re-read one", () => {
  it("sees the same chain read a minute later as unchanged, though its days-to-expiry moved", () => {
    const first = summarizeChain(chain, undefined, { expiry: "2026-11-27", now: Date.UTC(2026, 10, 13, 5, 0) })!;
    const later = summarizeChain(chain, undefined, { expiry: "2026-11-27", now: Date.UTC(2026, 10, 13, 5, 1) })!;

    expect(later.analytics.daysToExpiry).not.toBe(first.analytics.daysToExpiry);
    expect(key(chain, Date.UTC(2026, 10, 13, 5, 0))).toBe(key(chain, Date.UTC(2026, 10, 13, 5, 1)));
  });

  it("sees greeks that only drifted in the 4th decimal as unchanged", () => {
    const drifted: RawChain = { ...chain, strikes: [{ strike: 100, call: { ...leg(3, 100), greeks: { gamma: 0.01, theta: -1.0004 } }, put: leg(3, 200) }] };
    expect(key(drifted, 0)).toBe(key(chain, 0));
  });

  it("sees implied volatility that only jitters in the 8th decimal as unchanged", () => {
    const jittered: RawChain = { ...chain, strikes: [{ strike: 100, call: { ...leg(3, 100), implied_volatility: 15.00000004 }, put: leg(3, 200) }] };
    expect(key(jittered, 0)).toBe(key(chain, 0));
  });

  it("still sees implied volatility that moved by a visible amount", () => {
    const moved: RawChain = { ...chain, strikes: [{ strike: 100, call: { ...leg(3, 100), implied_volatility: 15.4 }, put: leg(3, 200) }] };
    expect(key(moved, 0)).not.toBe(key(chain, 0));
  });

  it("still sees a real change in the chain", () => {
    const moved: RawChain = { ...chain, strikes: [{ strike: 100, call: leg(3, 100), put: leg(3, 250) }] };
    expect(key(moved, 0)).not.toBe(key(chain, 0));
  });

  it("still sees a price move", () => {
    expect(key({ ...chain, lastPrice: 101 }, 0)).not.toBe(key(chain, 0));
  });
});

describe("shouldPollChain", () => {
  const base = { hasExpiries: true, isOpen: false, showLines: true };

  it("reads an instrument's chain as soon as it opens, with no panel needed, while the overlay is on", () => {
    expect(shouldPollChain(base)).toBe(true);
  });

  it("stops when the overlay is switched off and the panel is closed", () => {
    expect(shouldPollChain({ ...base, showLines: false })).toBe(false);
  });

  it("reads for an open panel even with the overlay off", () => {
    expect(shouldPollChain({ ...base, isOpen: true, showLines: false })).toBe(true);
  });

  it("never reads an instrument without options", () => {
    expect(shouldPollChain({ ...base, hasExpiries: false, isOpen: true })).toBe(false);
    expect(shouldPollChain({ ...base, hasExpiries: false })).toBe(false);
  });
});
