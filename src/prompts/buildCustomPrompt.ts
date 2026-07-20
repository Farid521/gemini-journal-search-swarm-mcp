import { buildDeterministicInstruction } from "./deterministicCheckPrompt.js";

/**
 * Bangun prompt final untuk Gemini worker (standard maupun custom).
 * Kalau customInstruction kosong/undefined, fallback ke instruksi default
 * yang sama persis dengan worker standard (§5.2).
 */
export function buildCustomPrompt(
  query: string,
  documentText: string,
  maxChars: number,
  customInstruction?: string
): string {
  const trimmed = customInstruction?.trim();
  const instructionBlock = trimmed && trimmed.length > 0
    ? trimmed
    : buildDeterministicInstruction(maxChars);

  return `${instructionBlock}\n\nQUERY: ${query}\n\nDOCUMENT_TEXT:\n${documentText}`;
}

export function buildStandardPrompt(
  query: string,
  documentText: string,
  maxChars: number
): string {
  return buildCustomPrompt(query, documentText, maxChars, undefined);
}
