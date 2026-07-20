import { z } from "zod";
import { tavilySearchInputSchema } from "../toolSchemas.js";
import { tavilySearch } from "../../services/tavilyClient.js";
import { getConfig } from "../../config.js";
import { ToolError, type ToolErrorCode } from "../../types.js";

export const tavilySearchToolDef = {
  name: "tavily_search",
  description:
    "Pass-through langsung ke Tavily Search API. Hasil dikembalikan langsung tanpa " +
    "lewat Gemini — untuk pencarian umum di luar alur verifikasi PDF jurnal.",
  inputSchema: tavilySearchInputSchema,
};

interface TavilySearchToolOutput {
  results: Array<{ title: string; url: string; content: string; score: number }>;
  error?: ToolErrorCode;
  error_detail?: string;
}

export async function handleTavilySearch(
  input: z.infer<typeof tavilySearchInputSchema>
): Promise<TavilySearchToolOutput> {
  try {
    const config = getConfig();
    const results = await tavilySearch(config.tavilyApiKey, input);
    return { results };
  } catch (err) {
    const code = err instanceof ToolError ? err.code : "upstream_search_failed";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return { results: [], error: code, error_detail: detail };
  }
}
