import { ToolError } from "../types.js";

/**
 * Handle yang dikembalikan oleh acquire(). Caller WAJIB memanggil release()
 * setelah buffer PDF sudah tidak dibutuhkan lagi (setelah pdfParse selesai
 * dan teks sudah diekstrak). Kalau lupa release → slot bocor, throughput turun.
 */
export interface ReleaseHandle {
  release: () => void;
}

interface Waiter {
  resolve: (handle: ReleaseHandle) => void;
  reject: (err: Error) => void;
  estimatedBytes: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Semaphore untuk membatasi jumlah PDF yang sedang didownload + di-parse
 * secara bersamaan. Dual-gating:
 *   1. maxConcurrent — maks slot paralel (default 3)
 *   2. maxTotalBytes — maks total bytes aktif di memory (default 100MB)
 *
 * Kalau kedua syarat terpenuhi, acquire() langsung resolve.
 * Kalau tidak, caller masuk antrian dan menunggu sampai slot tersedia
 * atau timeout tercapai (default 30 detik).
 *
 * Desain: Promise-based queue — zero CPU overhead saat menunggu, tidak
 * ada polling/busy-wait.
 */
export class DownloadSemaphore {
  private activeCount = 0;
  private activeBytes = 0;
  private queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxTotalBytes: number,
    private readonly waitTimeoutMs: number
  ) {}

  /**
   * Minta slot download. Kalau tersedia, langsung resolve.
   * Kalau penuh, masuk antrian dan menunggu sampai slot tersedia
   * atau timeout tercapai (→ ToolError "download_failed").
   *
   * @param estimatedBytes Estimasi ukuran file (dari Content-Length jika tersedia).
   *   Dipakai untuk tracking total bytes aktif. Kalau tidak tahu, pakai 0.
   */
  acquire(estimatedBytes: number = 0): Promise<ReleaseHandle> {
    if (this.canAcquire(estimatedBytes)) {
      return Promise.resolve(this.doAcquire(estimatedBytes));
    }

    return new Promise<ReleaseHandle>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Hapus waiter dari queue saat timeout
        const idx = this.queue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(
          new ToolError(
            "download_failed",
            `Download queue timeout setelah ${this.waitTimeoutMs}ms — server sedang sibuk memproses PDF lain. ` +
              `Aktif: ${this.activeCount}/${this.maxConcurrent} slot, ` +
              `${formatBytes(this.activeBytes)}/${formatBytes(this.maxTotalBytes)} memory. ` +
              `Antrian: ${this.queue.length} request. Coba lagi nanti.`
          )
        );
      }, this.waitTimeoutMs);

      this.queue.push({ resolve, reject, estimatedBytes, timer });
    });
  }

  /** Statistik untuk monitoring/debugging. */
  getStats(): {
    activeCount: number;
    activeBytes: number;
    queueLength: number;
    maxConcurrent: number;
    maxTotalBytes: number;
  } {
    return {
      activeCount: this.activeCount,
      activeBytes: this.activeBytes,
      queueLength: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxTotalBytes: this.maxTotalBytes,
    };
  }

  // ── Internals ──────────────────────────────────────────────

  private canAcquire(estimatedBytes: number): boolean {
    if (this.activeCount >= this.maxConcurrent) return false;
    // Kalau estimatedBytes = 0 (tidak tahu ukurannya), tetap izinkan
    // selama slot tersedia — lebih baik sedikit over daripada deadlock.
    if (estimatedBytes > 0 && this.activeBytes + estimatedBytes > this.maxTotalBytes) {
      return false;
    }
    return true;
  }

  private doAcquire(estimatedBytes: number): ReleaseHandle {
    this.activeCount += 1;
    this.activeBytes += estimatedBytes;
    let released = false;

    return {
      release: () => {
        if (released) return; // idempotent — cegah double-release
        released = true;
        this.activeCount -= 1;
        this.activeBytes = Math.max(0, this.activeBytes - estimatedBytes);
        this.tryDequeue();
      },
    };
  }

  private tryDequeue(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!this.canAcquire(next.estimatedBytes)) break;

      this.queue.shift();
      clearTimeout(next.timer);
      next.resolve(this.doAcquire(next.estimatedBytes));
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
