import { ToolError, type ToolErrorCode } from "../types.js";

const TAVILY_BASE_URL = "https://api.tavily.com";
const TAVILY_TIMEOUT_MS = 20_000;

export interface TavilySearchResultItem {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilyExtractResultItem {
  url: string;
  raw_content: string | null;
  success: boolean;
}

export interface TavilyCrawlResultItem {
  url: string;
  content: string;
}

async function tavilyPost<T>(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  errorCode: ToolErrorCode
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

  try {
    const response = await fetch(`${TAVILY_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = await response.text();
        if (errBody) detail += `: ${errBody.slice(0, 300)}`;
      } catch {
        // Abaikan kalau body error tidak bisa dibaca.
      }
      throw new ToolError(errorCode, `Tavily API error — ${detail}`);
    }

    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new ToolError(
      errorCode,
      isAbort
        ? `Tavily API timeout setelah ${TAVILY_TIMEOUT_MS}ms`
        : `Tavily API gagal dihubungi: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function tavilySearch(
  apiKey: string,
  params: {
    query: string;
    max_results?: number;
    search_depth?: "basic" | "advanced";
    include_domains?: string[];
    exclude_domains?: string[];
  }
): Promise<TavilySearchResultItem[]> {
  const data = await tavilyPost<{ results?: TavilySearchResultItem[] }>(
    "/search",
    apiKey,
    {
      query: params.query,
      max_results: params.max_results ?? 10,
      search_depth: params.search_depth ?? "basic",
      include_domains: params.include_domains,
      exclude_domains: params.exclude_domains,
    },
    "upstream_search_failed"
  );
  return data.results ?? [];
}

export async function tavilyExtract(
  apiKey: string,
  urls: string[]
): Promise<TavilyExtractResultItem[]> {
  const data = await tavilyPost<{
    results?: Array<{ url: string; raw_content?: string }>;
    failed_results?: Array<{ url: string }>;
  }>("/extract", apiKey, { urls }, "upstream_extract_failed");

  const successResults: TavilyExtractResultItem[] = (data.results ?? []).map((r) => ({
    url: r.url,
    raw_content: r.raw_content ?? null,
    success: true,
  }));
  const failedResults: TavilyExtractResultItem[] = (data.failed_results ?? []).map(
    (r) => ({
      url: r.url,
      raw_content: null,
      success: false,
    })
  );
  return [...successResults, ...failedResults];
}

export async function tavilyCrawl(
  apiKey: string,
  params: { url: string; max_depth?: number; limit?: number; instructions?: string }
): Promise<TavilyCrawlResultItem[]> {
  const data = await tavilyPost<{
    results?: Array<{ url: string; raw_content?: string }>;
  }>(
    "/crawl",
    apiKey,
    {
      url: params.url,
      max_depth: params.max_depth,
      limit: params.limit,
      instructions: params.instructions,
    },
    "upstream_crawl_failed"
  );
  return (data.results ?? []).map((r) => ({
    url: r.url,
    content: r.raw_content ?? "",
  }));
}
