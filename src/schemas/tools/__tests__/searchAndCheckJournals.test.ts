import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock kedua search client SEBELUM import handler
vi.mock("../../../services/tavilyClient.js", () => ({
  tavilySearch: vi.fn(),
}));
vi.mock("../../../services/exaClient.js", () => ({
  exaSearch: vi.fn(),
}));
vi.mock("../../../services/pdfMagicBytes.js", () => ({
  checkPdfMagicBytes: vi.fn(),
}));
vi.mock("../../../services/journalAnalysis.js", () => ({
  runJournalAnalysis: vi.fn(),
}));
vi.mock("../../../config.js", () => ({
  getConfig: vi.fn(),
}));

import { tavilySearch } from "../../../services/tavilyClient.js";
import { exaSearch } from "../../../services/exaClient.js";
import { getConfig } from "../../../config.js";
import { handleSearchAndCheckJournals } from "../searchAndCheckJournals.js";

const baseConfig = {
  tavilyApiKey: "tavily-key",
  exaApiKey: "exa-key",
  defaultMaxCandidates: 5,
};

describe("handleSearchAndCheckJournals — provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getConfig as any).mockReturnValue(baseConfig);
    (tavilySearch as any).mockResolvedValue([]);
    (exaSearch as any).mockResolvedValue([]);
  });

  it("REGRESI: tanpa search_provider, tetap panggil tavilySearch (backward compat)", async () => {
    await handleSearchAndCheckJournals({
      query: "fisika kuantum",
      max_candidates: 3,
      search_depth: "advanced",
    } as any);

    expect(tavilySearch).toHaveBeenCalledTimes(1);
    expect(exaSearch).not.toHaveBeenCalled();
    expect(tavilySearch).toHaveBeenCalledWith(
      "tavily-key",
      expect.objectContaining({
        query: "fisika kuantum",
        max_results: 6,
        search_depth: "advanced",
      })
    );
  });

  it("search_provider='tavily' eksplisit — perilaku identik dengan default", async () => {
    await handleSearchAndCheckJournals({
      query: "kimia organik",
      search_provider: "tavily",
    } as any);

    expect(tavilySearch).toHaveBeenCalledTimes(1);
    expect(exaSearch).not.toHaveBeenCalled();
  });

  it("search_provider='exa' — memanggil exaSearch, BUKAN tavilySearch", async () => {
    await handleSearchAndCheckJournals({
      query: "machine learning",
      max_candidates: 4,
      search_provider: "exa",
      exa_search_type: "neural",
    } as any);

    expect(exaSearch).toHaveBeenCalledTimes(1);
    expect(tavilySearch).not.toHaveBeenCalled();
    expect(exaSearch).toHaveBeenCalledWith(
      "exa-key",
      expect.objectContaining({
        query: "machine learning",
        numResults: 8,
        type: "neural",
      })
    );
  });

  it("search_provider='exa' TANPA exa_search_type — default ke 'auto'", async () => {
    await handleSearchAndCheckJournals({
      query: "biologi molekuler",
      search_provider: "exa",
    } as any);

    expect(exaSearch).toHaveBeenCalledWith(
      "exa-key",
      expect.objectContaining({ type: "auto" })
    );
  });

  it("search_provider='exa' — search_depth TIDAK BOLEH ikut terkirim ke exaSearch", async () => {
    await handleSearchAndCheckJournals({
      query: "astronomi",
      search_provider: "exa",
      search_depth: "advanced",
    } as any);

    expect(exaSearch).toHaveBeenCalledTimes(1);
    const callArgs = (exaSearch as any).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("search_depth");
  });

  it("search_provider='exa' tapi EXA_API_KEY tidak di-set — return error terstruktur, TIDAK throw", async () => {
    (getConfig as any).mockReturnValue({ ...baseConfig, exaApiKey: null });

    const result = await handleSearchAndCheckJournals({
      query: "test",
      search_provider: "exa",
    } as any);

    expect(exaSearch).not.toHaveBeenCalled();
    expect(result.error).toBe("invalid_input");
    expect(result.results).toEqual([]);
    expect(result.total_candidates_checked).toBe(0);
  });

  it("kalau exaSearch gagal (ToolError), return error terstruktur seperti pola tavily", async () => {
    const { ToolError } = await import("../../../types.js");
    (exaSearch as any).mockRejectedValue(new ToolError("upstream_search_failed", "exa down"));

    const result = await handleSearchAndCheckJournals({
      query: "test",
      search_provider: "exa",
    } as any);

    expect(result.error).toBe("upstream_search_failed");
    expect(result.error_detail).toBe("exa down");
  });
});
