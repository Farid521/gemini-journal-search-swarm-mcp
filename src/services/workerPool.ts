import { ToolError, type WorkerId } from "../types.js";

/**
 * Round-robin antara "gemini-1" dan "gemini-2" (worker standar, prompt deterministik
 * tetap). Thread-safety tidak jadi masalah nyata di Node.js single-threaded event loop,
 * tapi counter tetap di-guard dengan modulo yang aman terhadap overflow jangka panjang.
 */
class WorkerPool {
  private counter = 0;

  getStandardWorker(): Extract<WorkerId, "gemini-1" | "gemini-2"> {
    // Reset counter berkala supaya tidak overflow Number.MAX_SAFE_INTEGER
    // pada proses yang hidup sangat lama.
    if (this.counter >= Number.MAX_SAFE_INTEGER - 1) {
      this.counter = 0;
    }
    const worker = this.counter % 2 === 0 ? "gemini-1" : "gemini-2";
    this.counter += 1;
    return worker;
  }

  getCustomWorker(): "gemini-3" {
    return "gemini-3";
  }

  /**
   * Worker 4 (Lightpanda) — non-goal fase ini (§9). Slot disiapkan supaya
   * integrasi nanti tidak perlu refactor besar, tapi selalu melempar
   * ToolError("not_implemented") sekarang.
   */
  getBrowserWorker(): never {
    throw new ToolError(
      "not_implemented",
      "Worker 4 (Lightpanda/browser-rendering worker) belum diimplementasikan pada fase ini. " +
        "Lihat §9 spec untuk detail non-goals."
    );
  }
}

export const workerPool = new WorkerPool();
