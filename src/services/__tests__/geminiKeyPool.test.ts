import { describe, it, expect, beforeEach } from "vitest";
import { GeminiKeyPool } from "../geminiKeyPool.js";
import { ToolError } from "../../types.js";

describe("GeminiKeyPool Circuit Breaker", () => {
  let pool: GeminiKeyPool;

  beforeEach(() => {
    pool = new GeminiKeyPool(
      ["test-key-1"],
      { rpm: 60, tpm: 100_000, windowMs: 60_000 },
      { failureThreshold: 3, cooldownMs: 300 }
    );
  });

  it("harus mulai dengan status CLOSED", () => {
    const stats = pool.getCircuitStats();
    expect(stats.state).toBe("CLOSED");
    expect(stats.consecutiveFailures).toBe(0);
  });

  it("harus pindah ke OPEN setelah 3x recordFailure() berturut-turut", async () => {
    pool.recordFailure();
    pool.recordFailure();
    expect(pool.getCircuitStats().state).toBe("CLOSED");

    pool.recordFailure(); // Failure ke-3
    expect(pool.getCircuitStats().state).toBe("OPEN");

    // acquire() harus langsung throw fast-fail tanpa menunggu
    await expect(pool.acquire(100)).rejects.toThrow(ToolError);
  });

  it("harus pindah ke HALF_OPEN setelah cooldown berlalu dan kembali ke CLOSED jika sukses", async () => {
    pool.recordFailure();
    pool.recordFailure();
    pool.recordFailure(); // OPEN

    expect(pool.getCircuitStats().state).toBe("OPEN");

    // Tunggu 350ms (cooldown 300ms)
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Request berikutnya izinkan acquire (HALF_OPEN)
    const acquired = await pool.acquire(100);
    expect(acquired.apiKey).toBe("test-key-1");
    expect(pool.getCircuitStats().state).toBe("HALF_OPEN");

    // Jika dipanggil recordSuccess(), kembali ke CLOSED
    pool.recordSuccess();
    expect(pool.getCircuitStats().state).toBe("CLOSED");
    expect(pool.getCircuitStats().consecutiveFailures).toBe(0);
  });

  it("harus kembali ke OPEN jika request uji coba (HALF_OPEN) gagal lagi", async () => {
    pool.recordFailure();
    pool.recordFailure();
    pool.recordFailure(); // OPEN

    await new Promise((resolve) => setTimeout(resolve, 350)); // Tunggu cooldown

    await pool.acquire(100); // Masuk HALF_OPEN
    expect(pool.getCircuitStats().state).toBe("HALF_OPEN");

    // Request uji coba gagal
    pool.recordFailure();
    expect(pool.getCircuitStats().state).toBe("OPEN");
  });
});
