import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "./config.js";

import { tavilySearchToolDef, handleTavilySearch } from "./schemas/tools/tavilySearch.js";
import { tavilyExtractToolDef, handleTavilyExtract } from "./schemas/tools/tavilyExtract.js";
import { tavilyCrawlToolDef, handleTavilyCrawl } from "./schemas/tools/tavilyCrawl.js";
import { verifyPdfToolDef, handleVerifyPdf } from "./schemas/tools/verifyPdf.js";
import {
  analyzeJournalStandardToolDef,
  handleAnalyzeJournalStandard,
} from "./schemas/tools/analyzeJournalStandard.js";
import {
  analyzeJournalCustomToolDef,
  handleAnalyzeJournalCustom,
} from "./schemas/tools/analyzeJournalCustom.js";
import {
  searchAndCheckJournalsToolDef,
  handleSearchAndCheckJournals,
} from "./schemas/tools/searchAndCheckJournals.js";

/**
 * Bungkus hasil tool handler (yang selalu berupa objek JS biasa, tidak pernah
 * throw) jadi bentuk MCP tool response. Ini adalah lapisan terakhir yang
 * menjamin: apapun yang terjadi di handler, client MCP selalu menerima
 * response valid, bukan raw protocol error (§11).
 */
function toMcpResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Wrapper generik: jalankan handler tool, kalau ada exception yang lolos dari
 * semua lapisan try/catch di dalam handler (seharusnya tidak pernah terjadi,
 * tapi ini pertahanan terakhir), tetap bungkus jadi JSON error, bukan
 * melempar exception mentah ke MCP transport.
 */
function safeToolHandler<TInput, TOutput>(
  handler: (input: TInput) => Promise<TOutput>
) {
  return async (input: TInput) => {
    try {
      const result = await handler(input);
      return toMcpResult(result);
    } catch (err) {
      return toMcpResult({
        error: "internal_error",
        error_detail: `Unhandled exception di tool handler: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  };
}

export function buildMcpServer(): McpServer {
  // Memicu validasi config di sini secara eksplisit (dipanggil dari index.ts
  // sebelum ini), supaya kalau ada error fatal, sudah tertangkap sebelum
  // proses registrasi tool berjalan.
  const config = getConfig();

  const server = new McpServer({
    name: "journal-search-mcp",
    version: "1.0.0",
    icons: config.mcpIconUrl
      ? [
          {
            src: config.mcpIconUrl,
            mimeType: "image/png",
            sizes: ["any"],
          },
        ]
      : undefined,
  });

  server.tool(
    tavilySearchToolDef.name,
    tavilySearchToolDef.description,
    tavilySearchToolDef.inputSchema.shape,
    safeToolHandler(handleTavilySearch)
  );

  server.tool(
    tavilyExtractToolDef.name,
    tavilyExtractToolDef.description,
    tavilyExtractToolDef.inputSchema.shape,
    safeToolHandler(handleTavilyExtract)
  );

  server.tool(
    tavilyCrawlToolDef.name,
    tavilyCrawlToolDef.description,
    tavilyCrawlToolDef.inputSchema.shape,
    safeToolHandler(handleTavilyCrawl)
  );

  server.tool(
    verifyPdfToolDef.name,
    verifyPdfToolDef.description,
    verifyPdfToolDef.inputSchema.shape,
    safeToolHandler(handleVerifyPdf)
  );

  server.tool(
    analyzeJournalStandardToolDef.name,
    analyzeJournalStandardToolDef.description,
    analyzeJournalStandardToolDef.inputSchema.shape,
    safeToolHandler(handleAnalyzeJournalStandard)
  );

  server.tool(
    analyzeJournalCustomToolDef.name,
    analyzeJournalCustomToolDef.description,
    analyzeJournalCustomToolDef.inputSchema.shape,
    safeToolHandler(handleAnalyzeJournalCustom)
  );

  server.tool(
    searchAndCheckJournalsToolDef.name,
    searchAndCheckJournalsToolDef.description,
    searchAndCheckJournalsToolDef.inputSchema.shape,
    safeToolHandler(handleSearchAndCheckJournals)
  );

  return server;
}
