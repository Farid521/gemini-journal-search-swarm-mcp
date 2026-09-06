import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolError, type AnalyzeJournalOutput } from "../../types.js";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    checkPdfMagicBytes: vi.fn(),
    extractPdfText: vi.fn(),
    callGeminiJudge: vi.fn(),
    estimateTokens: vi.fn(),
    acquire: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    getCircuitStats: vi.fn(),
    settle: vi.fn(),
    release: vi.fn(),
    getStandardWorker: vi.fn(),
    getCustomWorker: vi.fn(),
  },
}));

vi.mock("../../config.js", () => ({
  getConfig: () => ({
    maxCharsPerDoc: 15_000,
    geminiKeyMaxWaitMs: 90_000,
    geminiModel: "gemini-3.1-flash-lite",
  }),
}));

vi.mock("../pdfMagicBytes.js", () => ({
  checkPdfMagicBytes: mocks.checkPdfMagicBytes,
}));

vi.mock("../pdfTextExtractor.js", () => ({
  extractPdfText: mocks.extractPdfText,
}));

vi.mock("../geminiClient.js", () => ({
  callGeminiJudge: mocks.callGeminiJudge,
  estimateTokens: mocks.estimateTokens,
}));

vi.mock("../geminiKeyPoolSingleton.js", () => ({
  geminiKeyPool: {
    acquire: mocks.acquire,
    recordSuccess: mocks.recordSuccess,
    recordFailure: mocks.recordFailure,
    getCircuitStats: mocks.getCircuitStats,
  },
}));

vi.mock("../workerPool.js", () => ({
  workerPool: {
    getStandardWorker: mocks.getStandardWorker,
    getCustomWorker: mocks.getCustomWorker,
  },
}));

import { runJournalAnalysis } from "../journalAnalysis.js";

function successAcquire() {
  return {
    apiKey: "test-key-1",
    keyIndex: 0,
    settle: mocks.settle,
    release: mocks.release,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkPdfMagicBytes.mockResolvedValue({
    url: "https://example.com/a.pdf",
    is_pdf: true,
    detected_signature: "25504446",
    http_status: 200,
  });
  mocks.extractPdfText.mockResolvedValue({
    text: "isi teks jurnal",
    truncated: false,
    original_length: 20,
  });
  mocks.estimateTokens.mockReturnValue(50);
  mocks.acquire.mockResolvedValue(successAcquire());
  mocks.getStandardWorker.mockReturnValue("gemini-1");
  mocks.getCustomWorker.mockReturnValue("gemini-3");
});

describe("runJournalAnalysis: wiring circuit breaker & release kuota", () => {
  it("sukses -> recordSuccess() dipanggil, recordFailure() TIDAK, settle() dipanggil", async () => {
    mocks.callGeminiJudge.mockResolvedValue({
      result: {
        is_relevant: true,
        has_basic_explanation: true,
        has_basic_equations: false,
        confidence: "high",
        reason: "relevan",
        journal_title: "Contoh Jurnal",
        apa_citation: "Penulis (2024). Contoh.",
      },
      usedTokens: 120,
    });

    const output = await runJournalAnalysis({ url: "https://example.com/a.pdf", query: "fisika" });

    expect(mocks.recordSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.recordFailure).not.toHaveBeenCalled();
    expect(mocks.settle).toHaveBeenCalledWith(120);
    expect(mocks.release).not.toHaveBeenCalled();

    expect(output.is_valid_pdf).toBe(true);
    expect(output.is_relevant).toBe(true);
    expect(output.journal_title).toBe("Contoh Jurnal");
    expect(output.apa_citation).toBe("Penulis (2024). Contoh.");
    expect(output.error).toBeUndefined();
  });

  it("call Gemini gagal -> recordFailure() + release() (kuota tidak bocor), output berisi error", async () => {
    mocks.callGeminiJudge.mockRejectedValue(
      new ToolError("gemini_call_failed", "Gemini call timeout setelah 15000ms")
    );

    const output = await runJournalAnalysis({ url: "https://example.com/a.pdf", query: "fisika" });

    expect(mocks.recordFailure).toHaveBeenCalledTimes(1);
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1); // key di-release

    expect(output.error).toBe("gemini_call_failed");
    expect(output.error_detail).toContain("timeout");
    expect(output.is_valid_pdf).toBe(true);
    expect(output.worker_id).toBe("gemini-1");
    expect(output.api_key_index).toBe(0);
  });

  it("3 kegagalan beruntun -> Circuit Breaker OPEN (fast-fail berikutnya)", async () => {
    mocks.callGeminiJudge.mockRejectedValue(new ToolError("gemini_call_failed", "down"));

    // Simulasikan wiring nyata: recordFailure menaikkan counter di pool
    let failures = 0;
    mocks.recordFailure.mockImplementation(() => {
      failures += 1;
      if (failures >= 3) {
        mocks.getCircuitStats.mockReturnValue({
          state: "OPEN",
          consecutiveFailures: 3,
          openUntil: Date.now() + 60_000,
        });
      } else {
        mocks.getCircuitStats.mockReturnValue({
          state: "CLOSED",
          consecutiveFailures: failures,
          openUntil: 0,
        });
      }
    });

    const outputs: AnalyzeJournalOutput[] = [];
    for (let i = 0; i < 3; i++) {
      outputs.push(
        await runJournalAnalysis({ url: "https://example.com/a.pdf", query: "fisika" })
      );
    }

    // Semua 3 call gagal dengan error terklasifikasi
    for (const o of outputs) {
      expect(o.error).toBe("gemini_call_failed");
    }
    expect(mocks.recordFailure).toHaveBeenCalledTimes(3);

    // Breaker dalam keadaan OPEN
    expect(mocks.getCircuitStats().state).toBe("OPEN");

    // Call berikutnya fast-fail tanpa acquire → recordFailure TIDAK dipanggil
    mocks.acquire.mockRejectedValue(
      new ToolError(
        "gemini_call_failed",
        "Gemini API terdeteksi down / unreachable (Circuit Breaker OPEN)."
      )
    );
    const next = await runJournalAnalysis({
      url: "https://example.com/a.pdf",
      query: "fisika",
    });
    expect(next.error).toBe("gemini_call_failed");
    expect(next.error_detail).toContain("Circuit Breaker OPEN");
    expect(mocks.callGeminiJudge).toHaveBeenCalledTimes(3); // tidak ada HTTP call ke-4
  });
});
