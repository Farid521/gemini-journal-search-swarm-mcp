import type { MagicBytesResult } from "../types.js";

const PDF_SIGNATURE_HEX = "2550444625"; // "%PDF-" tanpa dash terakhir dihitung manual di bawah
const EXPECTED_HEX = "255044462d"; // hex("%PDF-")
const TIMEOUT_MS = 10_000;
const RANGE_BYTES = 1024;
const MAX_RETRIES = 1; // 1x retry kalau timeout/connection error (§4)

function toHex(buf: Uint8Array, len: number): string {
  return Buffer.from(buf.slice(0, len)).toString("hex");
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function readFirstBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) {
    // Beberapa environment fetch (mis. undici versi lama) mungkin tidak stream body.
    const buf = new Uint8Array(await response.arrayBuffer());
    return buf.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
      }
    }
  } finally {
    // Selalu cancel stream setelah cukup byte, supaya tidak download seluruh file.
    try {
      await reader.cancel();
    } catch {
      // Abaikan error saat cancel — koneksi mungkin sudah ditutup server.
    }
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined.slice(0, maxBytes);
}

async function attemptCheck(url: string): Promise<MagicBytesResult> {
  const { signal, cancel } = withTimeout(TIMEOUT_MS);

  try {
    // 1. Coba Range request dulu (hemat bandwidth, §4 poin 1).
    let response = await fetch(url, {
      method: "GET",
      headers: { Range: `bytes=0-${RANGE_BYTES - 1}` },
      signal,
      redirect: "follow",
    });

    // 2. Kalau server tidak mendukung Range (bukan 206), tetap pakai response ini
    //    sebagai fallback biasa (§4 poin 2) — tidak perlu request kedua, cukup
    //    baca stream & potong di byte pertama.
    const bytes = await readFirstBytes(response, RANGE_BYTES);
    const signatureHex = toHex(bytes, 5);
    const isPdf = signatureHex === EXPECTED_HEX;

    return {
      url,
      is_pdf: isPdf,
      detected_signature: signatureHex || "(empty)",
      http_status: response.status,
      content_type_header: response.headers.get("content-type") ?? undefined,
    };
  } finally {
    cancel();
  }
}

/**
 * Verifikasi bahwa URL benar-benar file PDF lewat magic bytes (%PDF- di 5 byte pertama),
 * BUKAN lewat Content-Type header (tidak bisa dipercaya penuh — §4).
 *
 * Robust terhadap: timeout, connection error, server yang tidak dukung Range,
 * URL invalid, dan response non-2xx/3xx. Tidak pernah throw ke caller — selalu
 * mengembalikan MagicBytesResult, dengan `error`/`error_detail` terisi kalau gagal.
 */
export async function checkPdfMagicBytes(url: string): Promise<MagicBytesResult> {
  // Validasi awal URL supaya error jelas, bukan exception fetch yang membingungkan.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        url,
        is_pdf: false,
        detected_signature: "",
        http_status: 0,
        error: "download_failed",
        error_detail: `Protokol URL tidak didukung: "${parsed.protocol}"`,
      };
    }
  } catch (err) {
    return {
      url,
      is_pdf: false,
      detected_signature: "",
      http_status: 0,
      error: "download_failed",
      error_detail: `URL tidak valid: ${(err as Error).message}`,
    };
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await attemptCheck(url);
    } catch (err) {
      lastError = err;
      // Retry hanya untuk error transient (timeout/abort/network). Kalau masih
      // ada percobaan tersisa, lanjut; kalau sudah habis, jatuh ke bawah loop.
    }
  }

  const isAbort = lastError instanceof Error && lastError.name === "AbortError";
  return {
    url,
    is_pdf: false,
    detected_signature: "",
    http_status: 0,
    error: "download_failed",
    error_detail: isAbort
      ? `Timeout setelah ${TIMEOUT_MS}ms (sudah retry ${MAX_RETRIES}x)`
      : `Gagal fetch: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  };
}
