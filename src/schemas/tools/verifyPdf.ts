import { z } from "zod";
import { verifyPdfInputSchema } from "../toolSchemas.js";
import { checkPdfMagicBytes } from "../../services/pdfMagicBytes.js";
import type { MagicBytesResult } from "../../types.js";

export const verifyPdfToolDef = {
  name: "verify_pdf",
  description:
    "Verifikasi apakah sebuah URL benar-benar file PDF, memakai magic bytes " +
    "(%PDF- di 5 byte pertama), bukan Content-Type header yang tidak selalu bisa dipercaya.",
  inputSchema: verifyPdfInputSchema,
};

export async function handleVerifyPdf(
  input: z.infer<typeof verifyPdfInputSchema>
): Promise<MagicBytesResult> {
  // checkPdfMagicBytes sudah didesain untuk tidak pernah throw — tapi tetap
  // dibungkus try/catch di layer tool sebagai pertahanan berlapis (§11:
  // "semua tool tidak boleh throw ke MCP client mentah-mentah").
  try {
    return await checkPdfMagicBytes(input.url);
  } catch (err) {
    return {
      url: input.url,
      is_pdf: false,
      detected_signature: "",
      http_status: 0,
      error: "internal_error",
      error_detail: err instanceof Error ? err.message : String(err),
    };
  }
}
