import { describe, it, expect, vi, afterEach } from "vitest";
import { pollUntilReady } from "../../apps/api-server/acp-relay.js";

describe("pollUntilReady", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns true immediately when isReady is true on the first attempt", async () => {
    const isReady = vi.fn().mockResolvedValue(true);
    const result = await pollUntilReady(isReady, 100, 1000, 10_000);
    expect(result).toBe(true);
    expect(isReady).toHaveBeenCalledTimes(1);
  });

  it("returns true once isReady flips to true after several polls", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const isReady = vi.fn().mockImplementation(async () => ++calls >= 3);
    const resultPromise = pollUntilReady(isReady, 100, 1000, 10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await resultPromise).toBe(true);
    expect(calls).toBe(3);
  });

  it("returns false once the deadline is exceeded", async () => {
    vi.useFakeTimers();
    const isReady = vi.fn().mockResolvedValue(false);
    const resultPromise = pollUntilReady(isReady, 100, 500, 1_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await resultPromise).toBe(false);
    // Should have polled at least a few times before giving up.
    expect(isReady.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("backs off exponentially, capped at maxMs", async () => {
    vi.useFakeTimers();
    // Pin Math.random so jitter is exactly 1.0 (0.8 + 0.4 * 0.5).
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const isReady = vi.fn().mockResolvedValue(false);
    const gaps: number[] = [];
    let last = Date.now();
    isReady.mockImplementation(async () => {
      const now = Date.now();
      gaps.push(now - last);
      last = now;
      return false;
    });

    const resultPromise = pollUntilReady(isReady, 100, 500, 5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await resultPromise;

    // gaps[0] is before the first sleep — always 0. Skip it.
    // gaps[1] should be ~100ms, gaps[2] ~150, gaps[3] ~225, gaps[4] ~337, gaps[5] capped at 500.
    expect(gaps[1]).toBe(100);
    expect(gaps[2]).toBe(150);
    expect(gaps[3]).toBe(225);
    expect(gaps[4]).toBe(337);
    // After a few iterations the cap kicks in.
    const latest = gaps.slice(5);
    expect(latest.every((g) => g === 500)).toBe(true);
  });
});
