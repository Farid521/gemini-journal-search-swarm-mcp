interface Reservation {
  ok: true;
  settle: (actualTokens: number) => void;
  release: () => void;
}

interface RejectedReservation {
  ok: false;
}

type ReserveResult = Reservation | RejectedReservation;

interface RequestRecord {
  timestamp: number;
  tokens: number; // estimasi saat reserve; diupdate saat settle
}

/**
 * Sliding-window rate limiter untuk satu API key, membatasi RPM & TPM sekaligus.
 * Pola reserve -> settle -> release (§6.1):
 *   - reserve(estTokens): cek kuota, kalau cukup catat record & return handle.
 *   - settle(actualTokens): koreksi jumlah token record sesuai usage aktual.
 *   - release(): batalkan reservasi (dipakai kalau call gagal sebelum terkirim).
 *
 * Semua method robust terhadap pemanggilan ganda/tidak berurutan (mis. settle
 * dipanggil dua kali, atau release dipanggil setelah settle) — tidak akan
 * korupsi state, cukup no-op pada panggilan kedua.
 */
export class SlidingWindowLimiter {
  private records: RequestRecord[] = [];
  private readonly rpm: number;
  private readonly tpm: number;
  private readonly windowMs: number;

  constructor(opts: { rpm: number; tpm: number; windowMs: number }) {
    this.rpm = opts.rpm;
    this.tpm = opts.tpm;
    this.windowMs = opts.windowMs;
  }

  private pruneOld(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.records.length > 0 && this.records[0].timestamp < cutoff) {
      this.records.shift();
    }
  }

  private currentTokenSum(): number {
    return this.records.reduce((sum, r) => sum + r.tokens, 0);
  }

  tryReserve(estimatedTokens: number): ReserveResult {
    const now = Date.now();
    this.pruneOld(now);

    const wouldExceedRpm = this.records.length + 1 > this.rpm;
    const wouldExceedTpm = this.currentTokenSum() + estimatedTokens > this.tpm;

    if (wouldExceedRpm || wouldExceedTpm) {
      return { ok: false };
    }

    const record: RequestRecord = { timestamp: now, tokens: estimatedTokens };
    this.records.push(record);

    let settled = false;

    return {
      ok: true,
      settle: (actualTokens: number) => {
        if (settled) return; // idempotent — cegah double-settle korupsi state
        settled = true;
        if (Number.isFinite(actualTokens) && actualTokens >= 0) {
          record.tokens = actualTokens;
        }
        // Kalau actualTokens invalid, biarkan estimasi awal berlaku — lebih
        // aman (konservatif) daripada menganggap 0 token terpakai.
      },
      release: () => {
        if (settled) return; // sudah settle, tidak boleh di-release lagi
        settled = true;
        const idx = this.records.indexOf(record);
        if (idx !== -1) this.records.splice(idx, 1);
      },
    };
  }

  /**
   * Estimasi ms sampai kuota cukup untuk estimatedTokens berikutnya.
   * Return 0 kalau sudah tersedia sekarang.
   */
  msUntilAvailable(estimatedTokens: number): number {
    const now = Date.now();
    this.pruneOld(now);

    const rpmOk = this.records.length + 1 <= this.rpm;
    const tpmOk = this.currentTokenSum() + estimatedTokens <= this.tpm;
    if (rpmOk && tpmOk) return 0;

    if (this.records.length === 0) {
      // Tidak ada record tapi tetap dianggap tidak cukup — berarti
      // estimatedTokens sendiri melebihi tpm limit; window tidak akan
      // pernah cukup, tapi kita return windowMs supaya caller tidak infinite-loop
      // secepat mungkin dan bisa mendeteksi via maxWaitMs.
      return this.windowMs;
    }

    // Waktu sampai record tertua keluar dari window.
    const oldest = this.records[0];
    const msUntilOldestExpires = Math.max(0, oldest.timestamp + this.windowMs - now);
    return msUntilOldestExpires;
  }

  /** Berguna untuk observability/debugging (tidak dipakai di logic inti). */
  getStats(): { activeRequests: number; activeTokens: number } {
    this.pruneOld(Date.now());
    return {
      activeRequests: this.records.length,
      activeTokens: this.currentTokenSum(),
    };
  }
}
