import { z } from "zod";
import { searchAndCheckJournalsInputSchema } from "../toolSchemas.js";
import { tavilySearch } from "../../services/tavilyClient.js";
import { checkPdfMagicBytes } from "../../services/pdfMagicBytes.js";
import { runJournalAnalysis } from "../../services/journalAnalysis.js";
import { getConfig } from "../../config.js";
import { ToolError, type AnalyzeJournalOutput, type SearchAndCheckJournalsOutput } from "../../types.js";

export const searchAndCheckJournalsToolDef = {
  name: "search_and_check_journals",
  description:
    "Tool komposit: cari kandidat via Tavily, verifikasi tiap URL sebagai PDF asli " +
    "(magic bytes), lalu analisis kandidat valid lewat Gemini worker standar (round-robin). " +
    "Return array verdict siap pakai untuk beberapa kandidat jurnal sekaligus — Claude tidak " +
    "pernah menyentuh isi PDF mentah. Ini tool yang paling sering dipakai untuk flow verifikasi PDF lengkap.",
  inputSchema: searchAndCheckJournalsInputSchema,
};

const BATCH_SIZE = 2; // paralel kecil, supaya tidak membanjiri rate limiter (§7.7)

function emptyResultFor(url: string, errorCode: AnalyzeJournalOutput["error"]): AnalyzeJournalOutput {
  return {
    url,
    is_valid_pdf: false,
    worker_id: null,
    api_key_index: null,
    is_relevant: null,
    has_basic_explanation: null,
    has_basic_equations: null,
    confidence: null,
    reason: null,
    journal_title: null,
    apa_citation: null,
    error: errorCode,
  };
}

export async function handleSearchAndCheckJournals(
  input: z.infer<typeof searchAndCheckJournalsInputSchema>
): Promise<SearchAndCheckJournalsOutput> {
  const config = getConfig();
  const maxCandidates = input.max_candidates ?? config.defaultMaxCandidates;

  // 1. Tavily search — ambil lebih banyak kandidat dari yang dibutuhkan.
  let searchResults;
  try {
    searchResults = await tavilySearch(config.tavilyApiKey, {
      query: input.query,
      max_results: maxCandidates * 2,
      search_depth: input.search_depth ?? "basic",
    });
  } catch (err) {
    const code = err instanceof ToolError ? err.code : "upstream_search_failed";
    const detail = err instanceof ToolError ? err.detail : String(err);
    return {
      query: input.query,
      total_candidates_checked: 0,
      results: [],
      error: code,
      error_detail: detail,
    };
  }

  if (searchResults.length === 0) {
    return {
      query: input.query,
      total_candidates_checked: 0,
      results: [],
    };
  }

  // Sudah terurut skor dari Tavily; jaga urutan itu (§7.7 poin 2).
  const results: AnalyzeJournalOutput[] = [];
  let validPdfCount = 0;
  let checkedCount = 0;
  let cursor = 0;

  while (validPdfCount < maxCandidates && cursor < searchResults.length) {
    // Ambil batch kecil kandidat berikutnya untuk diverifikasi & dianalisis paralel.
    const batchCandidates = searchResults.slice(cursor, cursor + BATCH_SIZE);
    cursor += batchCandidates.length;

    if (batchCandidates.length === 0) break;

    // Verifikasi magic bytes untuk seluruh batch secara paralel.
    const magicBytesResults = await Promise.all(
      batchCandidates.map(async (candidate) => {
        try {
          return await checkPdfMagicBytes(candidate.url);
        } catch (err) {
          return {
            url: candidate.url,
            is_pdf: false,
            detected_signature: "",
            http_status: 0,
            error: "internal_error" as const,
            error_detail: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    checkedCount += magicBytesResults.length;

    // Pisahkan mana yang valid PDF (lanjut ke analisis) vs tidak (langsung short-circuit).
    const analysisPromises: Array<Promise<AnalyzeJournalOutput>> = [];

    for (const mb of magicBytesResults) {
      if (mb.error) {
        results.push(emptyResultFor(mb.url, mb.error));
        continue;
      }
      if (!mb.is_pdf) {
        results.push(emptyResultFor(mb.url, "not_a_valid_pdf"));
        continue;
      }
      analysisPromises.push(
        runJournalAnalysis({
          url: mb.url,
          query: input.query,
          forceCustomWorker: false,
        })
      );
    }

    if (analysisPromises.length > 0) {
      const analyzed = await Promise.all(analysisPromises);
      for (const a of analyzed) {
        results.push(a);
        if (a.is_valid_pdf && !a.error) {
          validPdfCount += 1;
        }
      }
    }

    // Guard tambahan: kalau batch tidak menghasilkan progres valid PDF sama
    // sekali dan kita sudah kehabisan kandidat, loop akan berhenti wajar lewat
    // kondisi while (cursor < searchResults.length).
  }

  return {
    query: input.query,
    total_candidates_checked: checkedCount,
    results,
  };
}
