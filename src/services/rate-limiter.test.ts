import { describe, expect, it, vi } from "vitest";
import { RateLimiter, sleep } from "./rate-limiter";

describe("sleep helper", () => {
  it("resolves immediately for non-positive milliseconds", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-10)).resolves.toBeUndefined();
  });

  it("resolves immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).resolves.toBeUndefined();
  });

  it("resolves early when signal is aborted during wait", async () => {
    const controller = new AbortController();
    const promise = sleep(10000, controller.signal);
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("RateLimiter", () => {
  it("allows requests up to maxRequests without delay", async () => {
    let currentTime = 1000;
    const sleeper = vi.fn(async () => {});
    const limiter = new RateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      minIntervalMs: 0,
      sleeper,
      now: () => currentTime,
    });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(sleeper).not.toHaveBeenCalled();
    expect(limiter.activeRequestCount).toBe(3);
  });

  it("enforces minIntervalMs between rapid requests", async () => {
    let currentTime = 1000;
    const sleeper = vi.fn(async (ms: number) => {
      currentTime += ms;
    });
    const limiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 60_000,
      minIntervalMs: 1000,
      sleeper,
      now: () => currentTime,
    });

    await limiter.acquire();
    expect(sleeper).not.toHaveBeenCalled();

    // Second request immediate -> needs 1000ms wait
    await limiter.acquire();
    expect(sleeper).toHaveBeenCalledWith(1000, undefined);
  });

  it("paces requests when maxRequests ceiling is reached within window", async () => {
    let currentTime = 1000;
    const reported: string[] = [];
    const sleeper = vi.fn(async (ms: number) => {
      currentTime += ms;
    });
    const limiter = new RateLimiter({
      maxRequests: 2,
      windowMs: 10_000,
      minIntervalMs: 0,
      sleeper,
      now: () => currentTime,
    });

    await limiter.acquire((msg) => reported.push(msg));
    currentTime += 2000; // t = 3000
    await limiter.acquire((msg) => reported.push(msg));

    expect(sleeper).not.toHaveBeenCalled();

    // 3rd request at t = 3000 exceeds maxRequests (2).
    // Oldest is at t = 1000. Wait = 1000 + 10_000 - 3000 + 200 = 8200 ms.
    await limiter.acquire((msg) => reported.push(msg));
    expect(sleeper).toHaveBeenCalled();
    expect(reported.length).toBeGreaterThan(0);
    expect(reported[0]).toContain("Pacing query");
  });

  it("aborts acquire immediately if signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const sleeper = vi.fn(async () => {});
    const limiter = new RateLimiter({ sleeper });

    await limiter.acquire(undefined, controller.signal);
    expect(sleeper).not.toHaveBeenCalled();
  });

  it("can be reset to clear tracked timestamps", async () => {
    let currentTime = 1000;
    const sleeper = vi.fn(async () => {});
    const limiter = new RateLimiter({
      maxRequests: 2,
      windowMs: 60_000,
      minIntervalMs: 0,
      sleeper,
      now: () => currentTime,
    });

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.activeRequestCount).toBe(2);

    limiter.reset();
    expect(limiter.activeRequestCount).toBe(0);
  });
});
