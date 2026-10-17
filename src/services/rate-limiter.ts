/** Sleep with support for early abortion via AbortSignal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RateLimiterOptions {
  /** Maximum requests allowed within windowMs (default: 25 to safely stay under Superset's 30/min limit). */
  maxRequests?: number;
  /** Sliding window duration in milliseconds (default: 60,000 ms = 1 minute). */
  windowMs?: number;
  /** Minimum interval in milliseconds between consecutive requests (default: 1000 ms). */
  minIntervalMs?: number;
  /** Custom sleeper function for testability. */
  sleeper?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Custom clock function for testability. */
  now?: () => number;
}

/**
 * Sliding-window rate limiter with minimum inter-request pacing.
 * Proactively prevents HTTP 429 (30 requests per 1 minute) by pacing queries.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private lastRequestTime = 0;
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly minIntervalMs: number;
  private readonly sleeper: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly getNow: () => number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxRequests = options.maxRequests ?? 25;
    this.windowMs = options.windowMs ?? 60_000;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.sleeper = options.sleeper ?? sleep;
    this.getNow = options.now ?? Date.now;
  }

  async acquire(reportWait?: (message: string) => void, signal?: AbortSignal): Promise<void> {
    while (true) {
      if (signal?.aborted) return;
      const now = this.getNow();

      // Prune timestamps outside rolling window
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

      // Enforce minimum interval between any two requests
      if (this.lastRequestTime > 0) {
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < this.minIntervalMs) {
          const waitMs = this.minIntervalMs - timeSinceLast;
          await this.sleeper(waitMs, signal);
          continue;
        }
      }

      // Enforce rolling window request ceiling
      if (this.timestamps.length >= this.maxRequests) {
        const oldest = this.timestamps[0];
        if (oldest !== undefined) {
          const waitMs = oldest + this.windowMs - now + 200;
          if (waitMs > 0) {
            const totalSec = Math.ceil(waitMs / 1000);
            for (let sec = totalSec; sec > 0; sec--) {
              if (signal?.aborted) return;
              reportWait?.(`Pacing query (${this.maxRequests}/30 per menit): menunggu ${sec}s agar tidak terkena limit Superset…`);
              const chunkMs = Math.min(1000, waitMs - (totalSec - sec) * 1000);
              await this.sleeper(chunkMs > 0 ? chunkMs : 1000, signal);
            }
            continue;
          }
        }
      }

      const timestamp = this.getNow();
      this.timestamps.push(timestamp);
      this.lastRequestTime = timestamp;
      return;
    }
  }

  reset(): void {
    this.timestamps = [];
    this.lastRequestTime = 0;
  }

  get activeRequestCount(): number {
    const now = this.getNow();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length;
  }
}
