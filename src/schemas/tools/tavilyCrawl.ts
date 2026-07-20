import { z } from "zod";
import { tavilyCrawlInputSchema } from "../toolSchemas.js";
import { tavilyCrawl, type TavilyCrawlResultItem } from "../../services/tavilyClient.js";
import { getConfig } from "../../config.js";
import { ToolError, type ToolErrorCode } from "../../types.js";

export const tavilyCrawlToolDef = {
  name: "tavily_crawl",
  description: "Pass-through ke Tavily Crawl API untuk menjelajahi sebuah situs/halaman.",
  inputSchema: tavilyCrawlInputSchema,
};

interface TavilyCrawlToolOutput {
  results: TavilyCrawlResultItem[];
  error?: ToolErrorCode;
  error_detail?: string;
}

export async function handleTavilyCrawl(
  input: z.infer<typeof tavilyCrawlInputSchema>
): Promise<TavilyCrawlToolOutput> {
  try {
    const config = getConfig();
    const results = await tavilyCrawl(config.tavilyApiKey, input);
    return { results };
  } catch (err) {
    const code = err instanceof ToolError ? err.code : "upstream_crawl_failed";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return { results: [], error: code, error_detail: detail };
  }
}
