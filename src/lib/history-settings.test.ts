import { describe, expect, it } from "bun:test";
import { autoInterval, defaultSettings, effectiveInterval, fromQuery, hasWeeklyOptions, maxWidth, normalize, toQuery } from "./history-settings";
import { INDEX_UNDERLYINGS, type Underlying } from "./option-underlyings";

const TODAY = "2026-11-13";
const nifty = INDEX_UNDERLYINGS.find((u) => u.name === "NIFTY")!;
const bankNifty = INDEX_UNDERLYINGS.find((u) => u.name === "BANKNIFTY")!;
const reliance: Underlying = { name: "RELIANCE", securityId: 2885, segment: "NSE_FNO", instrument: "OPTSTK", expiryFlag: "MONTH" };

describe("defaults and presets", () => {
  it("opens on the last two weeks ending today, with the interval chosen for that span", () => {
    const s = defaultSettings(nifty, TODAY);
    expect(s).toMatchObject({ range: "2W", from: "2026-10-31", to: TODAY, interval: "auto", expiryFlag: "WEEK" });
    expect(effectiveInterval(s)).toBe("5");
  });

  it("re-anchors a preset to today and sizes it", () => {
    expect(normalize({ ...defaultSettings(nifty, TODAY), range: "1M" }, TODAY).from).toBe("2026-10-15");
    expect(normalize({ ...defaultSettings(nifty, TODAY), range: "1W" }, TODAY).from).toBe("2026-11-07");
  });
});

describe("autoInterval", () => {
  it("uses finer bars for shorter ranges", () => {
    expect(autoInterval("2026-11-12", "2026-11-13")).toBe("1");
    expect(autoInterval("2026-11-04", "2026-11-13")).toBe("5");
    expect(autoInterval("2026-10-14", "2026-11-13")).toBe("15");
  });
});

describe("normalize", () => {
  it("keeps a chosen 1-minute interval and trims the range to seven days instead of refusing", () => {
    const s = normalize({ ...defaultSettings(nifty, TODAY), interval: "1", range: "1M" }, TODAY);
    expect(s.from).toBe("2026-11-07");
    expect(s.to).toBe(TODAY);
  });

  it("caps a custom range at 31 days and never reaches past today", () => {
    const s = normalize({ ...defaultSettings(nifty, TODAY), interval: "15", range: "custom", from: "2026-08-01", to: "2026-12-31" }, TODAY);
    expect(s.to).toBe(TODAY);
    expect(s.from).toBe("2026-10-14");
  });

  it("swaps nothing silently: a from after to collapses to one day", () => {
    const s = normalize({ ...defaultSettings(nifty, TODAY), range: "custom", from: "2026-11-12", to: "2026-11-10" }, TODAY);
    expect(s.from).toBe("2026-11-10");
  });

  it("only allows weekly options where they exist", () => {
    expect(hasWeeklyOptions(nifty)).toBe(true);
    expect(hasWeeklyOptions(bankNifty)).toBe(false);
    expect(normalize({ ...defaultSettings(bankNifty, TODAY), expiryFlag: "WEEK" }, TODAY).expiryFlag).toBe("MONTH");
    expect(normalize({ ...defaultSettings(reliance, TODAY), expiryFlag: "WEEK" }, TODAY).expiryFlag).toBe("MONTH");
  });

  it("limits the strangle width to what Dhan lists", () => {
    expect(maxWidth({ underlying: nifty, expiryCode: 1 })).toBe(10);
    expect(maxWidth({ underlying: nifty, expiryCode: 2 })).toBe(3);
    expect(normalize({ ...defaultSettings(reliance, TODAY), width: 8 }, TODAY).width).toBe(3);
  });
});

describe("URL round trip", () => {
  it("reopens exactly the view it was saved from", () => {
    const views = [
      normalize({ ...defaultSettings(nifty, TODAY), expiryCode: 2, width: 2, interval: "15", range: "1M" }, TODAY),
      normalize({ ...defaultSettings(reliance, TODAY), range: "custom", from: "2026-11-02", to: "2026-11-06" }, TODAY),
    ];
    for (const view of views) {
      expect(fromQuery(Object.fromEntries(toQuery(view)), TODAY)).toEqual(view);
    }
  });

  it("falls back to sensible defaults for a bare or broken link", () => {
    expect(fromQuery({}, TODAY)).toEqual(defaultSettings(nifty, TODAY));
    expect(fromQuery({ name: "NIFTY", range: "custom", from: "junk" }, TODAY).range).toBe("2W");
    expect(fromQuery({ name: "nifty", expiry: "9", interval: "7" }, TODAY)).toMatchObject({ expiryCode: 1, interval: "auto" });
  });
});
