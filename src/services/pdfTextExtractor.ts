import { ToolError } from "../types.js";
import { getConfig } from "../config.js";
import { getDownloadSemaphore } from "./downloadSemaphoreSingleton.js";

const DOWNLOAD_TIMEOUT_MS = 20_000;

interface ExtractResult {
  text: string;
  truncated: boolean;
  original_length: number;
}

async function downloadPdfBuffer(url: string, maxBytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });

    if (!response.ok) {
      throw new ToolError(
        "download_failed",
        `HTTP ${response.status} saat download PDF dari ${url}`
      );
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new ToolError(
        "download_failed",
        `Ukuran file (${contentLength} bytes) melebihi batas maksimum ${maxBytes} bytes`
      );
    }

    if (!response.body) {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new ToolError(
            "download_failed",
            `Ukuran file melebihi batas maksimum ${maxBytes} bytes saat streaming`
          );
        }
        chunks.push(value);
      }
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new ToolError(
      "download_failed",
      isAbort
        ? `Timeout setelah ${DOWNLOAD_TIMEOUT_MS}ms saat download PDF`
        : `Gagal download PDF: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download PDF dari URL lalu ekstrak teksnya dengan pdf-parse, dipotong ke maxChars.
 *
 * **Memory safety**: Seluruh siklus download + parse dibungkus dalam
 * global DownloadSemaphore yang membatasi:
 *   - Maks N download paralel (default 3)
 *   - Maks total bytes aktif di memory (default 100MB)
 * Kalau semua slot penuh, caller masuk antrian dan menunggu (atau timeout).
 *
 * Buffer di-null-kan segera setelah pdfParse selesai supaya GC bisa
 * melepas memory lebih cepat — penting saat banyak request bersamaan.
 *
 * Melempar ToolError dengan kode "download_failed" atau "extract_text_failed" kalau gagal
 * — TIDAK PERNAH melempar raw error/exception yang tidak terklasifikasi ke caller,
 * supaya tool layer selalu bisa membungkusnya jadi JSON (§11).
 */
export async function extractPdfText(
  url: string,
  maxChars: number
): Promise<ExtractResult> {
  const config = getConfig();
  const maxBytes = config.maxDownloadBytesPerFile;
  const semaphore = getDownloadSemaphore();

  // Acquire slot dari semaphore sebelum mulai download.
  // estimatedBytes = maxBytes sebagai worst-case (lebih aman konservatif).
  const handle = await semaphore.acquire(maxBytes);

  try {
    let buffer: Buffer | null = await downloadPdfBuffer(url, maxBytes);

    let parsed: { text: string };
    try {
      // Import dinamis supaya kegagalan load native/binary deps pdf-parse tidak
      // menjatuhkan seluruh proses server saat startup.
      const pdfParse = (await import("pdf-parse")).default;
      parsed = await pdfParse(buffer);
    } catch (err) {
      throw new ToolError(
        "extract_text_failed",
        `pdf-parse gagal memproses dokumen: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Null-kan buffer segera setelah parsing — bantu GC melepas memory lebih cepat.
    // Tanpa ini, buffer tetap direferensikan sampai function scope berakhir.
    buffer = null;

    const fullText = (parsed.text ?? "").trim();

    if (fullText.length === 0) {
      // Bisa jadi PDF hasil scan tanpa layer teks (OCR di luar scope — §9).
      throw new ToolError(
        "empty_document_text",
        "Ekstraksi teks menghasilkan string kosong (kemungkinan PDF hasil scan tanpa layer teks; OCR belum didukung)"
      );
    }

    const truncated = fullText.length > maxChars;
    return {
      text: truncated ? fullText.slice(0, maxChars) : fullText,
      truncated,
      original_length: fullText.length,
    };
  } finally {
    // SELALU release slot, baik sukses maupun gagal — mencegah slot bocor.
    handle.release();
  }
}
