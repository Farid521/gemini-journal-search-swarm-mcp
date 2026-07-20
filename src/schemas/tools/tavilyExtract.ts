import { z } from "zod";
import { tavilyExtractInputSchema } from "../toolSchemas.js";
import { tavilyExtract, type TavilyExtractResultItem } from "../../services/tavilyClient.js";
import { getConfig } from "../../config.js";
import { ToolError, type ToolErrorCode } from "../../types.js";

export const tavilyExtractToolDef = {
  name: "tavily_extract",
  description:
    "Pass-through ke Tavily Extract API. Untuk membaca isi halaman web biasa " +
    "(bukan PDF jurnal) secara langsung, misal halaman index jurnal untuk cari link PDF.",
  inputSchema: tavilyExtractInputSchema,
};

interface TavilyExtractToolOutput {
  results: TavilyExtractResultItem[];
  error?: ToolErrorCode;
  error_detail?: string;
}

export async function handleTavilyExtract(
  input: z.infer<typeof tavilyExtractInputSchema>
): Promise<TavilyExtractToolOutput> {
  try {
    const config = getConfig();
    const results = await tavilyExtract(config.tavilyApiKey, input.urls);
    return { results };
  } catch (err) {
    const code = err instanceof ToolError ? err.code : "upstream_extract_failed";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return { results: [], error: code, error_detail: detail };
  }
}
