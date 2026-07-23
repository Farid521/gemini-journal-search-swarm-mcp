import { ToolError } from "../types.js";

const EXA_BASE_URL = "https://api.exa.ai";
const EXA_TIMEOUT_MS = 20_000;

export interface ExaSearchResultItem {
  title: string;
  url: string;
  content: string;
  score: number;
}

export type ExaSearchType = "neural" | "keyword" | "auto";

/**
 * Client untuk Exa Search API (https://api.exa.ai/search).
 *
 * CATATAN PENTING (jangan hapus komentar ini saat maintenance):
 * Parameter `category` SENGAJA TIDAK diimplementasikan di sini. Testing manual oleh
 * pemilik project menunjukkan category filter (termasuk "research paper") menurunkan
 * kualitas hasil untuk use case target-link-PDF di project ini. Jangan tambahkan
 * kembali tanpa instruksi eksplisit dari pemilik project.
 */
export async function exaSearch(
  apiKey: string,
  params: {
    query: string;
    numResults?: number;
    type?: ExaSearchType;
  }
): Promise<ExaSearchResultItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXA_TIMEOUT_MS);

  try {
    const response = await fetch(`${EXA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: params.query,
        numResults: params.numResults ?? 10,
        type: params.type ?? "auto",
        contents: {
          text: true,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = await response.text();
        if (errBody) detail += `: ${errBody.slice(0, 300)}`;
      } catch {
        // abaikan, detail HTTP status sudah cukup
      }
      throw new ToolError("upstream_search_failed", `Exa API error — ${detail}`);
    }

    const data = (await response.json()) as {
      results?: Array<{ title?: string; url: string; text?: string; score?: number }>;
    };

    return (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url,
      content: r.text ?? "",
      score: r.score ?? 0,
    }));
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new ToolError(
      "upstream_search_failed",
      isAbort
        ? `Exa API timeout setelah ${EXA_TIMEOUT_MS}ms`
        : `Exa API gagal dihubungi: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}
