import { z } from "zod";
import { analyzeJournalStandardInputSchema } from "../toolSchemas.js";
import { runJournalAnalysis } from "../../services/journalAnalysis.js";
import type { AnalyzeJournalOutput } from "../../types.js";

export const analyzeJournalStandardToolDef = {
  name: "analyze_journal_standard",
  description:
    "Pipeline lengkap untuk satu URL: verify PDF -> extract text -> analisis oleh " +
    "Gemini worker standar (round-robin gemini-1/gemini-2, prompt deterministik " +
    "tidak bisa diubah) -> return JSON pendek berisi verdict relevansi & kelengkapan konten dasar.",
  inputSchema: analyzeJournalStandardInputSchema,
};

export async function handleAnalyzeJournalStandard(
  input: z.infer<typeof analyzeJournalStandardInputSchema>
): Promise<AnalyzeJournalOutput> {
  try {
    return await runJournalAnalysis({
      url: input.url,
      query: input.query,
      maxChars: input.max_chars,
      forceCustomWorker: false,
    });
  } catch (err) {
    // Pertahanan berlapis terakhir — runJournalAnalysis seharusnya tidak pernah
    // throw, tapi kalau ada bug tak terduga, tetap jangan biarkan raw exception
    // sampai ke MCP client (§11).
    return {
      url: input.url,
      is_valid_pdf: false,
      worker_id: null,
      api_key_index: null,
      is_relevant: null,
      has_basic_explanation: null,
      has_basic_equations: null,
      confidence: null,
      reason: null,
      error: "internal_error",
      error_detail: err instanceof Error ? err.message : String(err),
    };
  }
}
