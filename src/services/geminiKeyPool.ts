import { SlidingWindowLimiter } from "./rateLimiter.js";
import { AllKeysRateLimitedError, ToolError } from "../types.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface KeyState {
  apiKey: string;
  index: number; // 0, 1, 2 ...
  limiter: SlidingWindowLimiter;
}

export interface AcquiredKey {
  apiKey: string;
  keyIndex: number;
  settle: (actualTokens: number) => void;
  release: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs);
}

/**
 * Pool key Gemini dengan flow (§6.2) & Circuit Breaker Pattern:
 *   coba key-1 -> rate limited? coba key-2 -> ... -> semua rate limited?
 *   -> wait sampai key tercepat free -> ulangi dari key-1
 *   -> total wait > maxWaitMs -> throw AllKeysRateLimitedError (JANGAN hang selamanya)
 * 
 * Circuit Breaker:
 *   - CLOSED: Normal operation
 *   - OPEN: Terjadi N (default 3) failure berturut-turut -> reject instant (0ms) selama cooldownMs (default 60s)
 *   - HALF_OPEN: Cooldown selesai -> izinkan 1 request uji coba
 */
export class GeminiKeyPool {
  private keys: KeyState[];
  private circuitState: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(
    apiKeys: string[],
    rateLimitConfig: { rpm: number; tpm: number; windowMs: number },
    options?: { failureThreshold?: number; cooldownMs?: number }
  ) {

    if (!apiKeys || apiKeys.length === 0) {
      throw new Error("GeminiKeyPool memerlukan minimal 1 API key.");
    }
    
    this.keys = apiKeys.map((apiKey, index) => ({
      apiKey,
      index,
      limiter: new SlidingWindowLimiter(rateLimitConfig),
    }));
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 60_000;
  }

  get size(): number {
    return this.keys.length;
  }

  async acquire(estimatedTokens: number, maxWaitMs = 90_000): Promise<AcquiredKey> {
    const now = Date.now();

    // ── Cek Circuit Breaker ──────────────────────────────
    if (this.circuitState === "OPEN") {
      if (now < this.circuitOpenUntil) {
        const remainingSec = Math.ceil((this.circuitOpenUntil - now) / 1000);
        throw new ToolError(
          "gemini_call_failed",
          `Gemini API terdeteksi down / unreachable (Circuit Breaker OPEN). ` +
            `Fast-failing tanpa HTTP call. Berjalan kembali dalam ~${remainingSec}s.`
        );
      }
      // Masa cooldown selesai -> izinkan 1 request uji coba
      this.circuitState = "HALF_OPEN";
    }

    const startedAt = Date.now();

    // Guard: kalau estimatedTokens tidak valid, jangan biarkan logic rate-limit
    // jadi aneh (mis. NaN comparisons yang selalu false).
    const safeEstimate =
      Number.isFinite(estimatedTokens) && estimatedTokens >= 0 ? estimatedTokens : 0;

    while (true) {
      for (const state of this.keys) {
        const reservation = state.limiter.tryReserve(safeEstimate);
        if (reservation.ok) {
          return {
            apiKey: state.apiKey,
            keyIndex: state.index,
            settle: reservation.settle,
            release: reservation.release,
          };
        }
      }

      const waitMs = Math.min(
        ...this.keys.map((s) => s.limiter.msUntilAvailable(safeEstimate))
      );

      const elapsed = Date.now() - startedAt;

      if (elapsed + waitMs > maxWaitMs) {
        throw new AllKeysRateLimitedError(
          `Semua ${this.keys.length} API key rate limited, sudah menunggu ${elapsed}ms ` +
            `(batas maksimum ${maxWaitMs}ms).`
        );
      }

      // Jaga-jaga supaya tidak pernah sleep 0ms berulang tanpa henti kalau
      // msUntilAvailable mengembalikan 0 padahal reserve masih gagal (race
      // antar-call paralel) — beri jeda minimum kecil.
      const effectiveWait = Math.max(waitMs, 50);
      await sleep(effectiveWait + jitter(200));
      // loop mengulang, otomatis mulai lagi dari key-1
    }
  }

  /** Dipanggil saat Gemini API call berhasil */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitState = "CLOSED";
  }

  /** Dipanggil saat Gemini API call gagal (timeout / HTTP error / network failure) */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = "OPEN";
      this.circuitOpenUntil = Date.now() + this.cooldownMs;
    }
  }

  /** Status Circuit Breaker untuk health check / debugging */
  getCircuitStats(): { state: CircuitState; consecutiveFailures: number; openUntil: number } {
    return {
      state: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      openUntil: this.circuitOpenUntil,
    };
  }

  /** Observability: status ringkas tiap key, dipakai di /health atau debugging. */
  getStats(): Array<{ index: number; activeRequests: number; activeTokens: number }> {
    return this.keys.map((s) => ({
      index: s.index,
      ...s.limiter.getStats(),
    }));
  }
}
