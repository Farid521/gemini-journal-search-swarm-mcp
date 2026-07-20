import { z } from "zod";

export const tavilySearchInputSchema = z.object({
  query: z.string().min(1, "query tidak boleh kosong"),
  max_results: z.number().int().positive().max(50).optional(),
  search_depth: z.enum(["basic", "advanced"]).optional(),
  include_domains: z.array(z.string()).optional(),
  exclude_domains: z.array(z.string()).optional(),
});

export const tavilyExtractInputSchema = z.object({
  urls: z.array(z.string().url("setiap item urls harus URL valid")).min(1),
});

export const tavilyCrawlInputSchema = z.object({
  url: z.string().url("url harus valid"),
  max_depth: z.number().int().positive().max(10).optional(),
  limit: z.number().int().positive().max(200).optional(),
  instructions: z.string().optional(),
});

export const verifyPdfInputSchema = z.object({
  url: z.string().url("url harus valid"),
});

export const analyzeJournalStandardInputSchema = z.object({
  url: z.string().url("url harus valid"),
  query: z.string().min(1, "query tidak boleh kosong"),
  max_chars: z.number().int().positive().max(200_000).optional(),
});

export const analyzeJournalCustomInputSchema = z.object({
  url: z.string().url("url harus valid"),
  query: z.string().min(1, "query tidak boleh kosong"),
  custom_instruction: z.string().optional(),
  max_chars: z.number().int().positive().max(200_000).optional(),
  extra_fields_requested: z.array(z.string()).optional(),
});

export const searchAndCheckJournalsInputSchema = z.object({
  query: z.string().min(1, "query tidak boleh kosong"),
  max_candidates: z.number().int().positive().max(30).optional(),
  search_depth: z.enum(["basic", "advanced"]).optional(),
});
