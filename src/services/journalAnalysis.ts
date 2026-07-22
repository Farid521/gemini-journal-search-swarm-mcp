import { getConfig } from "../config.js";
import { checkPdfMagicBytes } from "./pdfMagicBytes.js";
import { extractPdfText } from "./pdfTextExtractor.js";
import { callGeminiJudge, estimateTokens } from "./geminiClient.js";
import { geminiKeyPool } from "./geminiKeyPoolSingleton.js";
import { workerPool } from "./workerPool.js";
import { buildStandardPrompt, buildCustomPrompt } from "../prompts/buildCustomPrompt.js";
import { ToolError, type AnalyzeJournalOutput, type WorkerId } from "../types.js";

function emptyAnalysisFields(): Pick<
  AnalyzeJournalOutput,
  | "worker_id"
  | "api_key_index"
  | "is_relevant"
  | "has_basic_explanation"
  | "has_basic_equations"
  | "confidence"
  | "reason"
  | "journal_title"
  | "apa_citation"
> {
  return {
    worker_id: null,
    api_key_index: null,
    is_relevant: null,
    has_basic_explanation: null,
    has_basic_equations: null,
    confidence: null,
    reason: null,
    journal_title: null,
    apa_citation: null,
  };
}

interface RunAnalysisOpts {
  url: string;
  query: string;
  maxChars?: number;
  /** Kalau diisi -> mode custom (worker-3). Kalau undefined -> mode standard (round-robin 1/2). */
  customInstruction?: string;
  extraFieldsRequested?: string[];
  forceCustomWorker?: boolean;
}

/**
 * Pipeline lengkap: verify PDF -> extract text -> pilih worker -> panggil Gemini
 * -> return JSON pendek (§7.5, §7.6). Tidak pernah throw — semua kegagalan
 * dibungkus ke field `error`/`error_detail` pada output, sesuai konvensi §11.
 */
export async function runJournalAnalysis(
  opts: RunAnalysisOpts
): Promise<AnalyzeJournalOutput> {
  const config = getConfig();
  const maxChars = opts.maxChars ?? config.maxCharsPerDoc;

  // 1. Verify PDF (magic bytes)
  let magicBytes;
  try {
    magicBytes = await checkPdfMagicBytes(opts.url);
  } catch (err) {
    return {
      url: opts.url,
      is_valid_pdf: false,
      ...emptyAnalysisFields(),
      error: "internal_error",
      error_detail: `Gagal saat verifikasi PDF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (magicBytes.error) {
    return {
      url: opts.url,
      is_valid_pdf: false,
      ...emptyAnalysisFields(),
      error: magicBytes.error,
      error_detail: magicBytes.error_detail,
    };
  }

  if (!magicBytes.is_pdf) {
    // Short-circuit — tidak lanjut ke extract/Gemini (§7.5).
    return {
      url: opts.url,
      is_valid_pdf: false,
      ...emptyAnalysisFields(),
      error: "not_a_valid_pdf",
    };
  }

  // 2. Extract text
  let extracted;
  try {
    extracted = await extractPdfText(opts.url, maxChars);
  } catch (err) {
    const code =
      err instanceof ToolError ? err.code : "extract_text_failed";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return {
      url: opts.url,
      is_valid_pdf: true,
      ...emptyAnalysisFields(),
      error: code,
      error_detail: detail,
    };
  }

  // 3. Pilih worker & bangun prompt
  const worker: WorkerId = opts.forceCustomWorker
    ? workerPool.getCustomWorker()
    : workerPool.getStandardWorker();

  const prompt = opts.forceCustomWorker
    ? buildCustomPrompt(opts.query, extracted.text, maxChars, opts.customInstruction)
    : buildStandardPrompt(opts.query, extracted.text, maxChars);

  // 4. Acquire API key dari pool (independen dari worker role — §6.3)
  let acquired;
  try {
    acquired = await geminiKeyPool.acquire(
      estimateTokens(prompt),
      config.geminiKeyMaxWaitMs
    );
  } catch (err) {
    const code = err instanceof ToolError ? err.code : "all_keys_rate_limited";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return {
      url: opts.url,
      is_valid_pdf: true,
      ...emptyAnalysisFields(),
      worker_id: worker,
      error: code,
      error_detail: detail,
    };
  }

  // 5. Panggil Gemini, settle/release key sesuai hasil
  try {
    const { result, usedTokens } = await callGeminiJudge(
      acquired.apiKey,
      config.geminiModel,
      prompt
    );
    acquired.settle(usedTokens);

    const output: AnalyzeJournalOutput = {
      url: opts.url,
      is_valid_pdf: true,
      worker_id: worker,
      api_key_index: acquired.keyIndex,
      is_relevant: result.is_relevant,
      has_basic_explanation: result.has_basic_explanation,
      has_basic_equations: result.has_basic_equations,
      confidence: result.confidence,
      reason: result.reason,
      journal_title: result.journal_title ?? null,
      apa_citation: result.apa_citation ?? null,
    };

    // extra_fields_requested (§5.2) — best-effort, tidak divalidasi ketat.
    if (opts.extraFieldsRequested && opts.extraFieldsRequested.length > 0) {
      for (const field of opts.extraFieldsRequested) {
        if (field in result) {
          output[field] = result[field];
        } else {
          output[field] = null;
        }
      }
    }

    return output;
  } catch (err) {
    // Call gagal setelah reservasi -> release supaya kuota tidak "bocor".
    acquired.release();
    const code = err instanceof ToolError ? err.code : "gemini_call_failed";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return {
      url: opts.url,
      is_valid_pdf: true,
      ...emptyAnalysisFields(),
      worker_id: worker,
      api_key_index: acquired.keyIndex,
      error: code,
      error_detail: detail,
    };
  }
}
