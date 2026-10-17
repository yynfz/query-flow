import { serializeWorkbook, downloadWorkbook, type QueryResult } from "./excel";
import type { SqlChunkResponse } from "../types";
import { RateLimiter, sleep } from "./rate-limiter";

export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
export const EXPORT_CHECKPOINT_ROWS = 250_000;

/** Retrieval pages are accumulated into one workbook, independent of table boundaries. */
export class ChunkedExport {
  private results: QueryResult[] = [];
  parts = 0;
  totalRows = 0;
  private checkpointedRows = 0;
  private incrementalOutput = false;

  constructor(
    private readonly path: string,
    private readonly download = downloadWorkbook,
    private readonly maxBytes = MAX_EXPORT_BYTES,
    private readonly serialize = serializeWorkbook,
    private readonly checkpointRows = 0,
  ) {}

  async append(result: QueryResult): Promise<void> {
    const existing = this.results.find((entry) => entry.filename === result.filename);
    if (existing) {
      for (const row of result.rows) existing.rows.push(row);
    } else {
      this.results.push({ ...result, rows: [...result.rows] });
    }
    this.totalRows += result.rows.length;
    if (this.checkpointRows > 0 && this.totalRows - this.checkpointedRows >= this.checkpointRows) {
      await this.flush(false);
      this.checkpointedRows = this.totalRows;
    }
  }

  async flush(final: boolean, partial = false): Promise<void> {
    if (!final) this.incrementalOutput = true;
    while (this.results.length) {
      let selected = this.results;
      let buffer = await this.serialize(selected);
      let remainder: QueryResult[] = [];
      const split = buffer.byteLength > this.maxBytes || this.parts > 0 || this.incrementalOutput;
      // Measure real XLSX bytes, including ZIP compression and workbook overhead.
      // Halve oversized prefixes until each downloadable workbook fits.
      while (buffer.byteLength > this.maxBytes) {
        const units = selected.reduce((sum, sheet) => sum + Math.max(1, sheet.rows.length), 0);
        if (units <= 1) throw new Error("Satu baris/header Excel melebihi batas 20 MB dan tidak dapat dipecah lagi.");
        let remaining = Math.floor(units / 2);
        const prefix: QueryResult[] = [];
        const suffix: QueryResult[] = [];
        for (const sheet of selected) {
          const count = Math.max(1, sheet.rows.length);
          if (remaining >= count) {
            prefix.push(sheet);
            remaining -= count;
          } else if (remaining > 0) {
            prefix.push({ ...sheet, rows: sheet.rows.slice(0, remaining) });
            suffix.push({ ...sheet, rows: sheet.rows.slice(remaining) });
            remaining = 0;
          } else {
            suffix.push(sheet);
          }
        }
        selected = prefix;
        remainder = [...suffix, ...remainder];
        buffer = await this.serialize(selected);
      }
      const suffix = split ? `_part-${String(this.parts + 1).padStart(3, "0")}` : "";
      await this.download(`${this.path}${suffix}${partial ? "_partial" : ""}`, buffer);
      this.parts++;
      // Retain everything not successfully downloaded if serialization/download fails.
      this.results = remainder;
    }
  }
}

export function isRateLimitError(message: string): boolean {
  return /429|too many requests|rate limit|quota exceeded|30 per 1 minute/i.test(message);
}

export function getRateLimitCooldownSeconds(retryCount: number): number {
  if (retryCount <= 1) return 20;
  if (retryCount === 2) return 35;
  return 60;
}

export interface CollectQueryOptions {
  startRow?: number;
  maxRows?: number;
  onColumns?: (columns: string[]) => void;
  rateLimiter?: RateLimiter;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxRateLimitRetries?: number;
  getCooldownSeconds?: (retryCount: number) => number;
}

/** Retry size failures at the same offset; advance only after a chunk is accepted. Paces requests and retries 429. */
export async function collectQuery(
  request: (offset: number, limit: number, iteration: number) => Promise<SqlChunkResponse>,
  accept: (columns: string[], rows: unknown[][]) => Promise<void>,
  stopped: () => boolean,
  report: (message: string) => void,
  signal?: AbortSignal,
  options: CollectQueryOptions = {},
): Promise<void> {
  const parsedStartRow = Number(options.startRow);
  let offset = Number.isFinite(parsedStartRow) && parsedStartRow >= 1 ? Math.floor(parsedStartRow) - 1 : 0;
  const parsedMaxRows = Number(options.maxRows);
  const maxRows = Number.isFinite(parsedMaxRows) && parsedMaxRows > 0 ? Math.floor(parsedMaxRows) : undefined;
  let collectedRows = 0;
  let limit = Math.min(9000, maxRows ?? 9000);
  let iteration = 1;
  let isContinuation = false;
  let rateLimitRetries = 0;
  const maxRateLimitRetries = options.maxRateLimitRetries ?? 5;
  const sleeper = options.sleep ?? sleep;
  const getCooldown = options.getCooldownSeconds ?? getRateLimitCooldownSeconds;

  while (!stopped()) {
    if (signal?.aborted) break;

    // Acquire rate limit slot for new SQL queries (not continuation from memory cursor)
    if (!isContinuation && options.rateLimiter) {
      await options.rateLimiter.acquire(report, signal);
      if (stopped() || signal?.aborted) break;
    }

    let response: SqlChunkResponse;
    try {
      const pending = request(offset, limit, iteration);
      if (signal) {
        let cancel: () => void = () => {};
        const cancelled = new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("Run dihentikan oleh pengguna."));
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
        });
        try {
          response = await Promise.race([pending, cancelled]);
        } finally {
          signal.removeEventListener("abort", cancel);
        }
      } else {
        response = await pending;
      }
    } catch (error) {
      response = { ok: false, message: error instanceof Error ? error.message : "Koneksi SQL Lab terputus." };
    }

    if (!response.ok) {
      if (stopped() || signal?.aborted) break;

      // Handle 429 Too Many Requests (Rate limiting from Superset / DB engine)
      if (isRateLimitError(response.message)) {
        if (rateLimitRetries >= maxRateLimitRetries) {
          throw new Error(`Batas percobaan ulang rate limit tercapai (${maxRateLimitRetries}x). ${response.message}`);
        }
        rateLimitRetries++;
        options.rateLimiter?.reset();
        const cooldownSec = getCooldown(rateLimitRetries);
        for (let sec = cooldownSec; sec > 0; sec--) {
          if (stopped() || signal?.aborted) break;
          report(`Rate limit 429 tercapai (30/menit). Menunggu cooldown ${sec}s sebelum mencoba lagi (percobaan ${rateLimitRetries}/${maxRateLimitRetries})…`);
          await sleeper(1000, signal);
        }
        if (stopped() || signal?.aborted) break;
        report(`Mencoba ulang dari baris ${offset + 1} setelah cooldown rate limit…`);
        continue;
      }

      // Handle payload size limits
      if (limit > 1 && /exceed|too (?:large|big)|size.{0,30}limit|limit.{0,30}(?:size|bytes|mb)|payload|out of memory/i.test(response.message)) {
        limit = Math.max(1, Math.floor(limit / 2));
        report(`Batas ukuran tercapai. Mengulang dari baris ${offset + 1} dengan chunk ${limit} baris…`);
        continue;
      }

      throw new Error(response.message);
    }

    // Reset rate limit retry count upon any successful response
    rateLimitRetries = 0;

    options.onColumns?.(response.columns);
    // A chunk that finished concurrently with Stop is still valid and exported.
    if (response.rows.length || offset === 0) await accept(response.columns, response.rows);
    collectedRows += response.rows.length;
    if (stopped()) break;
    if (maxRows !== undefined && collectedRows >= maxRows) return;
    if (response.continuation) {
      isContinuation = true;
      iteration++;
      continue;
    }
    isContinuation = false;
    if (!response.hasMore) return;
    if (!response.rows.length) throw new Error("Chunk kosong tetapi hasil belum selesai; proses dihentikan agar tidak mengulang tanpa akhir.");
    offset += response.pageSize ?? limit;
    limit = Math.min(9000, maxRows === undefined ? 9000 : maxRows - collectedRows);
    iteration++;
  }
  throw new Error("Run dihentikan oleh pengguna.");
}
