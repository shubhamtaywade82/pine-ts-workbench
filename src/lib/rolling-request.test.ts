import { describe, expect, it } from "bun:test";
import { dateWindows, parseRollingQuery, strikeFor } from "./rolling-request";

const TODAY = "2026-11-13";
const query = (over: Record<string, string> = {}) => parseRollingQuery(new URLSearchParams({
  segment: "NSE_FNO", instrument: "OPTIDX", expiryFlag: "WEEK", expiryCode: "1", securityId: "13",
  width: "0", interval: "5", from: "2026-11-02", to: "2026-11-12", ...over,
}), TODAY);

describe("parseRollingQuery", () => {
  it("accepts a valid query", () => {
    expect(query()).toMatchObject({ segment: "NSE_FNO", securityId: 13, width: 0, interval: "5", from: "2026-11-02" });
  });

  it("rejects bad enums and ids with a reason", () => {
    expect(query({ segment: "NSE_EQ" })).toContain("segment");
    expect(query({ expiryCode: "4" })).toContain("expiryCode");
    expect(query({ interval: "7" })).toContain("interval");
    expect(query({ securityId: "abc" })).toContain("securityId");
  });

  it("allows ±10 strikes only for index options on the nearest expiry", () => {
    expect(typeof query({ width: "10" })).toBe("object");
    expect(query({ width: "4", expiryCode: "2" })).toContain("0 to 3");
    expect(query({ width: "4", instrument: "OPTSTK", expiryFlag: "MONTH" })).toContain("0 to 3");
  });

  it("limits the range, more tightly at one minute", () => {
    expect(query({ from: "2026-10-01", to: "2026-11-12" })).toContain("31 days");
    expect(query({ interval: "1" })).toContain("7 days");
    expect(typeof query({ interval: "1", from: "2026-11-06" })).toBe("object");
  });

  it("rejects reversed, future and too-old ranges", () => {
    expect(query({ from: "2026-11-12", to: "2026-11-02" })).toContain("after");
    expect(query({ to: "2026-11-14", from: "2026-11-13" })).toContain("future");
    expect(query({ from: "2020-01-01", to: "2020-01-02" })).toContain("five years");
  });
});

describe("dateWindows", () => {
  it("covers the range in two-day windows", () => {
    expect(dateWindows("2026-11-10", "2026-11-13")).toEqual([
      { from: "2026-11-10", to: "2026-11-11" }, { from: "2026-11-12", to: "2026-11-13" },
    ]);
  });

  it("skips a window that is only a weekend, keeping one that touches a weekday", () => {
    // 7-8 Nov 2026 is a Saturday and Sunday; 9 Nov is a Monday.
    expect(dateWindows("2026-11-07", "2026-11-09")).toEqual([{ from: "2026-11-09", to: "2026-11-09" }]);
    expect(dateWindows("2026-11-06", "2026-11-07")).toEqual([{ from: "2026-11-06", to: "2026-11-07" }]);
  });

  it("handles a single day", () => {
    expect(dateWindows("2026-11-12", "2026-11-12")).toEqual([{ from: "2026-11-12", to: "2026-11-12" }]);
  });
});

describe("strikeFor", () => {
  it("puts the call above the money and the put below it", () => {
    expect(strikeFor("CALL", 0)).toBe("ATM");
    expect(strikeFor("CALL", 2)).toBe("ATM+2");
    expect(strikeFor("PUT", 2)).toBe("ATM-2");
  });
});
