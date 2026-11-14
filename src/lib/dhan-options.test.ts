import { describe, expect, it } from "bun:test";
import { cachedCall } from "./dhan-options";

const TTL = 1_000;
const MAX_STALE = 10_000;

const setup = () => {
  const cache = new Map<string, { at: number; value: string }>();
  const call = cachedCall<string>(cache, new Map(), TTL, MAX_STALE, (task) => task());
  return { cache, call };
};
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("cachedCall", () => {
  it("loads once for a first request and serves the cache while it is fresh", async () => {
    const { call } = setup();
    let loads = 0;
    const load = async () => `value-${++loads}`;

    const first = await call("k", load);
    const second = await call("k", load);

    expect(loads).toBe(1);
    expect(second).toEqual(first);
  });

  it("serves a slightly stale answer at once and refreshes behind it", async () => {
    const { cache, call } = setup();
    cache.set("k", { at: Date.now() - 5_000, value: "old" });
    let release: (value: string) => void = () => undefined;
    const slowLoad = () => new Promise<string>((resolve) => { release = resolve; });

    const answer = await call("k", slowLoad); // does not wait for the load

    expect(answer.value).toBe("old");
    release("new");
    await settle();
    expect(cache.get("k")!.value).toBe("new");
  });

  it("shares one refresh between callers that arrive while it runs", async () => {
    const { cache, call } = setup();
    cache.set("k", { at: Date.now() - 5_000, value: "old" });
    let loads = 0;
    let release: (value: string) => void = () => undefined;
    const slowLoad = () => { loads += 1; return new Promise<string>((resolve) => { release = resolve; }); };

    await Promise.all([call("k", slowLoad), call("k", slowLoad), call("k", slowLoad)]);
    release("new");
    await settle();

    expect(loads).toBe(1);
  });

  it("waits for a fresh load once the answer is too old to show", async () => {
    const { cache, call } = setup();
    cache.set("k", { at: Date.now() - 60_000, value: "ancient" });

    const answer = await call("k", async () => "fresh");

    expect(answer.value).toBe("fresh");
  });

  it("keeps serving the old answer when a refresh fails", async () => {
    const { cache, call } = setup();
    cache.set("k", { at: Date.now() - 60_000, value: "old" });

    const answer = await call("k", async () => { throw new Error("dhan down"); });

    expect(answer.value).toBe("old");
  });

  it("throws when there is nothing to fall back to", async () => {
    const { call } = setup();
    await expect(call("k", async () => { throw new Error("dhan down"); })).rejects.toThrow("dhan down");
  });

  it("keeps different keys apart", async () => {
    const { call } = setup();
    const a = await call("a", async () => "A");
    const b = await call("b", async () => "B");
    expect([a.value, b.value]).toEqual(["A", "B"]);
  });
});
