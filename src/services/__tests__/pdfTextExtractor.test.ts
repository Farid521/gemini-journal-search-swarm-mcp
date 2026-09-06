import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ToolError } from "../../types.js";

const { fakeConfig } = vi.hoisted(() => ({
  fakeConfig: {
    maxDownloadBytesPerFile: 1_000,
    maxConcurrentDownloads: 1,
    maxTotalDownloadBytes: 10_000,
    downloadSemaphoreTimeoutMs: 2_000,
  },
}));

vi.mock("../../config.js", () => ({
  getConfig: () => fakeConfig,
  ConfigError: class ConfigError extends Error {},
}));

const { pdfParseMock } = vi.hoisted(() => ({
  pdfParseMock: vi.fn(async (buffer: Buffer) => ({
    text: `contoh teks dari pdf dengan ${buffer.byteLength} bytes`,
    numpages: 1,
  })),
}));

vi.mock("pdf-parse", () => ({
  default: pdfParseMock,
}));

import { extractPdfText } from "../pdfTextExtractor.js";
import { getDownloadSemaphore } from "../downloadSemaphoreSingleton.js";

function streamResponse(chunks: Uint8Array[], contentLength: string | null) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-length" ? contentLength : null),
    },
    body: {
      getReader: () => ({
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: chunks[i++] })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  } as unknown as Response;
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("extractPdfText dengan DownloadSemaphore + batas ukuran configurable", () => {
  it("sukses: download, parse, dan slot semaphore di-release (stats 0)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([new Uint8Array([1, 2, 3, 4])], "4")
    );
    global.fetch = fetchMock;

    const result = await extractPdfText("https://example.com/a.pdf", 10_000);

    expect(result.truncated).toBe(false);
    expect(result.original_length).toBeGreaterThan(0);
    expect(result.text).toContain("contoh teks dari pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Slot semaphore harus sudah di-release — tidak ada yang bocor
    const stats = getDownloadSemaphore().getStats();
    expect(stats.activeCount).toBe(0);
    expect(stats.activeBytes).toBe(0);
    expect(stats.queueLength).toBe(0);
  });

  it("truncate teks kalau melebihi maxChars", async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse([new Uint8Array([1])], "1"));

    const result = await extractPdfText("https://example.com/a.pdf", 5);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(5);
    expect(result.original_length).toBeGreaterThan(5);
  });

  it("content-length melebihi batas -> ToolError download_failed dan slot di-release", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(streamResponse([], String(fakeConfig.maxDownloadBytesPerFile + 1)));
    global.fetch = fetchMock;

    await expect(extractPdfText("https://example.com/big.pdf", 1_000)).rejects.toBeInstanceOf(
      ToolError
    );
    await expect(extractPdfText("https://example.com/big.pdf", 1_000)).rejects.toMatchObject({
      code: "download_failed",
    });

    // Slot semaphore di-release walau gagal (try/finally)
    expect(getDownloadSemaphore().getStats().activeCount).toBe(0);
  });

  it("streaming melebihi batas -> ToolError download_failed + reader.cancel", async () => {
    const cancelSpy = vi.fn();
    const bigChunk = new Uint8Array(fakeConfig.maxDownloadBytesPerFile + 10);
    const response = streamResponse([bigChunk], null) as unknown as {
      ok: boolean;
      body: { getReader: () => unknown };
    };
    const streamWithCancel = {
      ...response,
      body: {
        getReader: () => {
          let read = false;
          return {
            read: () => {
              if (!read) {
                read = true;
                return Promise.resolve({ done: false, value: bigChunk });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
            cancel: cancelSpy,
          };
        },
      },
    };
    global.fetch = vi.fn().mockResolvedValue(streamWithCancel);

    await expect(extractPdfText("https://example.com/stream.pdf", 1_000)).rejects.toMatchObject({
      code: "download_failed",
    });
    expect(cancelSpy).toHaveBeenCalled();

    // Slot semaphore di-release walau gagal
    expect(getDownloadSemaphore().getStats().activeCount).toBe(0);
  });

  it("HTTP error -> ToolError download_failed", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as unknown as Response);

    await expect(extractPdfText("https://example.com/404.pdf", 1_000)).rejects.toMatchObject({
      code: "download_failed",
    });
    expect(getDownloadSemaphore().getStats().activeCount).toBe(0);
  });
});
