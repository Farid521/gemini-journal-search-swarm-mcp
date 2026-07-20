import { z } from "zod";
import { analyzeJournalCustomInputSchema } from "../toolSchemas.js";
import { runJournalAnalysis } from "../../services/journalAnalysis.js";
import type { AnalyzeJournalOutput } from "../../types.js";

export const analyzeJournalCustomToolDef = {
  name: "analyze_journal_custom",
  description:
    "Sama seperti analyze_journal_standard, tapi selalu memakai worker gemini-3 dan " +
    "menerima custom_instruction opsional untuk override prompt (fallback ke prompt " +
    "default kalau kosong). Bisa juga minta field tambahan lewat extra_fields_requested " +
    "(best-effort, tidak divalidasi ketat).",
  inputSchema: analyzeJournalCustomInputSchema,
};

export async function handleAnalyzeJournalCustom(
  input: z.infer<typeof analyzeJournalCustomInputSchema>
): Promise<AnalyzeJournalOutput> {
  try {
    return await runJournalAnalysis({
      url: input.url,
      query: input.query,
      maxChars: input.max_chars,
      customInstruction: input.custom_instruction,
      extraFieldsRequested: input.extra_fields_requested,
      forceCustomWorker: true,
    });
  } catch (err) {
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
