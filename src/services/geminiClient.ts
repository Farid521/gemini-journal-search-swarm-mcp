import { GoogleGenerativeAI } from "@google/generative-ai";
import { ToolError, type GeminiJudgeResult } from "../types.js";
import { buildStrictJsonRetryInstruction } from "../prompts/deterministicCheckPrompt.js";

const GEMINI_CALL_TIMEOUT_MS = 30_000;
// Estimasi kasar token: ~4 karakter per token (dipakai untuk reserve() sebelum
// tahu usage aktual dari response).
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / CHARS_PER_TOKEN_ESTIMATE);
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function tryParseJudgeResult(raw: string): GeminiJudgeResult | null {
  const cleaned = stripMarkdownFence(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.is_relevant === "boolean" &&
      typeof parsed.has_basic_explanation === "boolean" &&
      typeof parsed.has_basic_equations === "boolean" &&
      typeof parsed.reason === "string" &&
      (parsed.confidence === "high" ||
        parsed.confidence === "medium" ||
        parsed.confidence === "low")
    ) {
      return parsed as GeminiJudgeResult;
    }
    return null; // JSON valid tapi shape tidak sesuai schema
  } catch {
    return null;
  }
}

async function callGeminiRaw(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ text: string; usedTokens: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_CALL_TIMEOUT_MS);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const generativeModel = genAI.getGenerativeModel({ model });

    const result = await generativeModel.generateContent(
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      },
      { signal: controller.signal }
    );

    const text = result.response.text();
    const usageTokens =
      result.response.usageMetadata?.totalTokenCount ?? estimateTokens(prompt);

    return { text, usedTokens: usageTokens };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new ToolError(
      "gemini_call_failed",
      isAbort
        ? `Gemini call timeout setelah ${GEMINI_CALL_TIMEOUT_MS}ms`
        : `Gemini call gagal: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Panggil Gemini dengan prompt yang sudah dibangun, parse hasilnya sebagai
 * GeminiJudgeResult. Kalau parsing gagal, retry 1x dengan instruksi JSON yang
 * lebih tegas (§11 - "gemini_invalid_json_response") sebelum give up.
 *
 * Melempar ToolError, TIDAK PERNAH raw exception, supaya caller (tools layer)
 * selalu bisa membungkus jadi output JSON yang aman.
 */
export async function callGeminiJudge(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ result: GeminiJudgeResult; usedTokens: number }> {
  const firstAttempt = await callGeminiRaw(apiKey, model, prompt);
  const parsed = tryParseJudgeResult(firstAttempt.text);

  if (parsed) {
    return { result: parsed, usedTokens: firstAttempt.usedTokens };
  }

  // Retry 1x dengan instruksi lebih tegas.
  const retryPrompt = buildStrictJsonRetryInstruction(prompt);
  const secondAttempt = await callGeminiRaw(apiKey, model, retryPrompt);
  const parsedRetry = tryParseJudgeResult(secondAttempt.text);

  if (parsedRetry) {
    return {
      result: parsedRetry,
      usedTokens: firstAttempt.usedTokens + secondAttempt.usedTokens,
    };
  }

  throw new ToolError(
    "gemini_invalid_json_response",
    "Gemini tidak mengembalikan JSON valid setelah 1x retry."
  );
}
