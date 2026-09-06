import { describe, it, expect, beforeEach, vi } from "vitest";

const { fakeConfig, generateContentMock } = vi.hoisted(() => ({
  fakeConfig: { geminiCallTimeoutMs: 15_000 },
  generateContentMock: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  getConfig: () => fakeConfig,
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: generateContentMock };
    }
  },
}));

import { callGeminiJudge } from "../geminiClient.js";

beforeEach(() => {
  fakeConfig.geminiCallTimeoutMs = 15_000;
  generateContentMock.mockReset();
});

describe("geminiClient: timeout configurable (dari config, bukan hardcode)", () => {
  it("generateContent yang menggantung di-abort sesuai geminiCallTimeoutMs dari config", async () => {
    fakeConfig.geminiCallTimeoutMs = 50;

    // Simulasi call yang tidak pernah selesai — hanya batal kalau signal abort dipicu
    generateContentMock.mockImplementation((_request: unknown, options: { signal: AbortSignal }) => {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    await expect(callGeminiJudge("key", "gemini-3.1-flash-lite", "prompt")).rejects.toBeInstanceOf(
      Error
    );
    await expect(
      callGeminiJudge("key", "gemini-3.1-flash-lite", "prompt")
    ).rejects.toMatchObject({
      code: "gemini_call_failed",
    });
    await expect(
      callGeminiJudge("key", "gemini-3.1-flash-lite", "prompt")
    ).rejects.toThrow(/timeout/);
  });

  it("sukses dengan JSON valid -> hasil di-parse, usedTokens dari usageMetadata", async () => {
    fakeConfig.geminiCallTimeoutMs = 5_000;
    generateContentMock.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            is_relevant: true,
            has_basic_explanation: true,
            has_basic_equations: false,
            confidence: "medium",
            reason: "pembahasan cocok",
          }),
        usageMetadata: { totalTokenCount: 88 },
      },
    });

    const { result, usedTokens } = await callGeminiJudge(
      "key",
      "gemini-3.1-flash-lite",
      "prompt"
    );
    expect(result.is_relevant).toBe(true);
    expect(result.reason).toBe("pembahasan cocok");
    expect(usedTokens).toBe(88);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("JSON tidak valid setelah retry -> gemini_invalid_json_response (2x call)", async () => {
    fakeConfig.geminiCallTimeoutMs = 5_000;
    generateContentMock.mockResolvedValue({
      response: { text: () => "bukan json", usageMetadata: undefined },
    });

    await expect(
      callGeminiJudge("key", "gemini-3.1-flash-lite", "prompt")
    ).rejects.toMatchObject({ code: "gemini_invalid_json_response" });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
