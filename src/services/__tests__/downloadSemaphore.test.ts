import { describe, it, expect } from "vitest";
import { DownloadSemaphore } from "../downloadSemaphore.js";
import { ToolError } from "../../types.js";

describe("DownloadSemaphore smoke test", () => {
  it("acquire langsung resolve saat slot tersedia, stats benar", async () => {
    const sem = new DownloadSemaphore(3, 100 * 1024, 1000);
    const h = await sem.acquire(1024);

    const stats = sem.getStats();
    expect(stats.activeCount).toBe(1);
    expect(stats.activeBytes).toBe(1024);
    expect(stats.queueLength).toBe(0);

    h.release();
    expect(sem.getStats().activeCount).toBe(0);
    expect(sem.getStats().activeBytes).toBe(0);
  });

  it("acquire ke-2 antri saat maxConcurrent=1, jalan setelah release (FIFO)", async () => {
    const sem = new DownloadSemaphore(1, 100 * 1024, 1000);
    const h1 = await sem.acquire(100);

    let secondResolved = false;
    const second = sem.acquire(50).then((h2) => {
      secondResolved = true;
      h2.release();
      return true;
    });

    // Beri waktu — harusnya masih antri
    await new Promise((r) => setTimeout(r, 50));
    expect(secondResolved).toBe(false);
    expect(sem.getStats().queueLength).toBe(1);

    h1.release();
    await expect(second).resolves.toBe(true);
    expect(sem.getStats().queueLength).toBe(0);
    expect(sem.getStats().activeCount).toBe(0);
  });

  it("byte gating: acquire dengan estimatedBytes besar masuk antrian", async () => {
    const sem = new DownloadSemaphore(3, 1000, 1000);
    const h1 = await sem.acquire(600); // sisa 400
    const h2 = await sem.acquire(400); // sisa 0

    // Penuh dari sisi bytes (0 tersisa), bukan slot
    let resolved = false;
    const h3 = sem.acquire(10).then((h) => {
      resolved = true;
      h.release();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);

    h2.release();
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(true);

    h1.release();
  });

  it("timeout antrian -> ToolError download_failed", async () => {
    const sem = new DownloadSemaphore(1, 100 * 1024, 100);
    const h1 = await sem.acquire(10);

    await expect(sem.acquire(10)).rejects.toBeInstanceOf(ToolError);
    await expect(sem.acquire(10)).rejects.toMatchObject({
      code: "download_failed",
    });

    h1.release();
  });

  it("release() idempotent — double release tidak mengacaukan slot", async () => {
    const sem = new DownloadSemaphore(1, 100 * 1024, 1000);
    const h = await sem.acquire(10);
    h.release();
    h.release();

    // Slot tetap bisa dipakai request berikutnya
    const h2 = await sem.acquire(10);
    expect(sem.getStats().activeCount).toBe(1);
    h2.release();
  });

  it("semua slot kembali 0 setelah semua release (tidak bocor)", async () => {
    const sem = new DownloadSemaphore(3, 100 * 1024, 1000);
    const handles = [];
    for (let i = 0; i < 3; i++) {
      handles.push(await sem.acquire(100));
    }
    expect(sem.getStats().activeCount).toBe(3);

    handles.forEach((h) => h.release());
    expect(sem.getStats().activeCount).toBe(0);
    expect(sem.getStats().activeBytes).toBe(0);
    expect(sem.getStats().queueLength).toBe(0);
  });
});
