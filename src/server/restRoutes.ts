import type { Express, Request, Response } from "express";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { authMiddleware } from "./authMiddleware.js";

import { tavilySearchInputSchema, tavilyExtractInputSchema, tavilyCrawlInputSchema, verifyPdfInputSchema, analyzeJournalStandardInputSchema, analyzeJournalCustomInputSchema, searchAndCheckJournalsInputSchema } from "../schemas/toolSchemas.js";

import { handleTavilySearch } from "../schemas/tools/tavilySearch.js";
import { handleTavilyExtract } from "../schemas/tools/tavilyExtract.js";
import { handleTavilyCrawl } from "../schemas/tools/tavilyCrawl.js";
import { handleVerifyPdf } from "../schemas/tools/verifyPdf.js";
import { handleAnalyzeJournalStandard } from "../schemas/tools/analyzeJournalStandard.js";
import { handleAnalyzeJournalCustom } from "../schemas/tools/analyzeJournalCustom.js";
import { handleSearchAndCheckJournals } from "../schemas/tools/searchAndCheckJournals.js";

function makePostRoute<TInput, TOutput>(
  schema: ZodType<TInput, ZodTypeDef, any>,
  handler: (input: TInput) => Promise<TOutput>
) {
  return async (req: Request, res: Response) => {
    let parsedInput: TInput;
    try {
      parsedInput = schema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: "invalid_input",
          error_detail: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        });
        return;
      }
      res.status(400).json({ error: "invalid_input", error_detail: String(err) });
      return;
    }

    try {
      const result = await handler(parsedInput);
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({
        error: "internal_error",
        error_detail: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function registerRestRoutes(app: Express): void {
  const base = "/api";

  app.post(`${base}/tavily-search`, authMiddleware, makePostRoute(tavilySearchInputSchema, handleTavilySearch));
  app.post(`${base}/tavily-extract`, authMiddleware, makePostRoute(tavilyExtractInputSchema, handleTavilyExtract));
  app.post(`${base}/tavily-crawl`, authMiddleware, makePostRoute(tavilyCrawlInputSchema, handleTavilyCrawl));
  app.post(`${base}/verify-pdf`, authMiddleware, makePostRoute(verifyPdfInputSchema, handleVerifyPdf));
  app.post(`${base}/analyze-journal-standard`, authMiddleware, makePostRoute(analyzeJournalStandardInputSchema, handleAnalyzeJournalStandard));
  app.post(`${base}/analyze-journal-custom`, authMiddleware, makePostRoute(analyzeJournalCustomInputSchema, handleAnalyzeJournalCustom));
  app.post(`${base}/search-and-check-journals`, authMiddleware, makePostRoute(searchAndCheckJournalsInputSchema, handleSearchAndCheckJournals));

  app.get(`${base}/tools`, authMiddleware, (req: Request, res: Response) => {
    res.status(200).json({
      tools: [
        { name: "tavily_search", method: "POST", path: `${base}/tavily-search` },
        { name: "tavily_extract", method: "POST", path: `${base}/tavily-extract` },
        { name: "tavily_crawl", method: "POST", path: `${base}/tavily-crawl` },
        { name: "verify_pdf", method: "POST", path: `${base}/verify-pdf` },
        { name: "analyze_journal_standard", method: "POST", path: `${base}/analyze-journal-standard` },
        { name: "analyze_journal_custom", method: "POST", path: `${base}/analyze-journal-custom` },
        { name: "search_and_check_journals", method: "POST", path: `${base}/search-and-check-journals` },
      ],
    });
  });
}
