import { buildCriteriaBlock, buildFormatEnforcementBlock, buildDeterministicInstruction } from "./deterministicCheckPrompt.js";

/**
 * Bangun prompt final untuk Gemini worker (standard maupun custom).
 *
 * Struktur prompt:
 *   [CRITERIA BLOCK]        ← bisa di-override oleh customInstruction
 *   [FORMAT ENFORCEMENT]    ← selalu dipaksa, tidak pernah hilang
 *   QUERY: ...
 *   DOCUMENT_TEXT: ...
 *
 * Memisahkan dua lapisan ini memastikan bahwa walau caller menyediakan
 * customInstruction (misalnya menambah kriteria tambahan), instruksi
 * "Jawab HANYA dalam JSON valid …" tetap ada sehingga Gemini tidak
 * merespons dengan teks bebas / markdown yang gagal di-parse.
 */
export function buildCustomPrompt(
  query: string,
  documentText: string,
  maxChars: number,
  customInstruction?: string
): string {
  const trimmed = customInstruction?.trim();

  // Criteria block: kalau customInstruction diisi, gunakan itu sebagai
  // pengganti rubrik default — hanya bagian kriteria, bukan format.
  const criteriaBlock =
    trimmed && trimmed.length > 0
      ? trimmed
      : buildCriteriaBlock(maxChars);

  // Format block SELALU disertakan, tidak bisa di-override.
  const formatBlock = buildFormatEnforcementBlock();

  return `${criteriaBlock}\n\n${formatBlock}\n\nQUERY: ${query}\n\nDOCUMENT_TEXT:\n${documentText}`;
}

export function buildStandardPrompt(
  query: string,
  documentText: string,
  maxChars: number
): string {
  return buildCustomPrompt(query, documentText, maxChars, undefined);
}
