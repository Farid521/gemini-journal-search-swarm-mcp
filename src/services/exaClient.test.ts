import { describe, it, expect, vi, afterEach } from "vitest";
import { exaSearch } from "./exaClient.js";
import { ToolError } from "../types.js";

describe("exaSearch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("mengembalikan hasil yang sudah dinormalisasi dari response Exa", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "Paper A", url: "https://example.com/a.pdf", text: "isi a", score: 0.9 },
          { title: "Paper B", url: "https://example.com/b.pdf", text: "isi b", score: 0.8 },
        ],
      }),
    } as Response);

    const result = await exaSearch("fake-key", { query: "fisika kuantum" });

    expect(result).toEqual([
      { title: "Paper A", url: "https://example.com/a.pdf", content: "isi a", score: 0.9 },
      { title: "Paper B", url: "https://example.com/b.pdf", content: "isi b", score: 0.8 },
    ]);
  });

  it("mengirim header x-api-key dan body yang benar, TANPA field category", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);
    global.fetch = fetchMock;

    await exaSearch("fake-key", { query: "test query", numResults: 5, type: "neural" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.exa.ai/search");
    expect(options.headers["x-api-key"]).toBe("fake-key");

    const sentBody = JSON.parse(options.body);
    expect(sentBody.query).toBe("test query");
    expect(sentBody.numResults).toBe(5);
    expect(sentBody.type).toBe("neural");
    // GUARD TEST — jangan sampai field category diam-diam ditambahkan lagi
    expect(sentBody).not.toHaveProperty("category");
  });

  it("default type ke 'auto' kalau tidak diberikan", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);
    global.fetch = fetchMock;

    await exaSearch("fake-key", { query: "test" });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.type).toBe("auto");
  });

  it("throw ToolError dengan code upstream_search_failed kalau HTTP tidak ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    } as Response);

    await expect(exaSearch("bad-key", { query: "test" })).rejects.toThrow(ToolError);
    await expect(exaSearch("bad-key", { query: "test" })).rejects.toMatchObject({
      code: "upstream_search_failed",
    });
  });

  it("throw ToolError kalau timeout", async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          const err = new Error("aborted");
          err.name = "AbortError";
          setTimeout(() => reject(err), 10);
        })
    );

    await expect(exaSearch("fake-key", { query: "test" })).rejects.toMatchObject({
      code: "upstream_search_failed",
    });
  });
});
