export type WorkerId = "gemini-1" | "gemini-2" | "gemini-3";

export type Confidence = "high" | "medium" | "low";

/** Kode error singkat yang dipakai di field `error` pada output tool (§11). */
export type ToolErrorCode =
  | "not_a_valid_pdf"
  | "download_failed"
  | "extract_text_failed"
  | "empty_document_text"
  | "gemini_invalid_json_response"
  | "gemini_call_failed"
  | "all_keys_rate_limited"
  | "not_implemented"
  | "upstream_search_failed"
  | "upstream_extract_failed"
  | "upstream_crawl_failed"
  | "invalid_input"
  | "internal_error";

export interface MagicBytesResult {
  url: string;
  is_pdf: boolean;
  detected_signature: string; // hex 5 byte pertama, untuk debug
  http_status: number;
  content_type_header?: string;
  error?: ToolErrorCode;
  error_detail?: string;
}

export interface GeminiJudgeResult {
  is_relevant: boolean;
  has_basic_explanation: boolean;
  has_basic_equations: boolean;
  confidence: Confidence;
  reason: string;
  journal_title?: string;
  apa_citation?: string;
  [extraField: string]: unknown; // untuk extra_fields_requested (§5.2)
}

export interface AnalyzeJournalOutput {
  url: string;
  is_valid_pdf: boolean;
  worker_id: WorkerId | null;
  api_key_index: number | null;
  is_relevant: boolean | null;
  has_basic_explanation: boolean | null;
  has_basic_equations: boolean | null;
  confidence: Confidence | null;
  reason: string | null;
  journal_title: string | null;
  apa_citation: string | null;
  error?: ToolErrorCode;
  error_detail?: string;
  [extraField: string]: unknown;
}

export interface SearchAndCheckJournalsOutput {
  query: string;
  total_candidates_checked: number;
  results: AnalyzeJournalOutput[];
  error?: ToolErrorCode;
  error_detail?: string;
}

/** Struktur error internal yang dilempar antar-service sebelum dibungkus jadi JSON. */
export class ToolError extends Error {
  code: ToolErrorCode;
  detail?: string;

  constructor(code: ToolErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = "ToolError";
    this.code = code;
    this.detail = detail;
  }
}

export class AllKeysRateLimitedError extends ToolError {
  constructor(detail: string) {
    super("all_keys_rate_limited", detail);
    this.name = "AllKeysRateLimitedError";
  }
}
