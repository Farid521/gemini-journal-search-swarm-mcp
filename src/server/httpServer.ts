import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authMiddleware } from "./authMiddleware.js";
import { registerFaviconRoute } from "./favicon.js";
import { registerRestRoutes } from "./restRoutes.js";
import { getConfig } from "../config.js";

export function createHttpApp(mcpServer: McpServer): Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // Tangkap error JSON.parse dari express.json() supaya tidak jadi HTML
  // default error page — tetap balas JSON konsisten.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && "body" in (err as unknown as Record<string, unknown>)) {
      res.status(400).json({ error: "invalid_json_body" });
      return;
    }
    next(err);
  });

  // --- /mcp — endpoint utama MCP (butuh auth) ---
  app.all("/mcp", authMiddleware, async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });
      res.on("close", () => {
        transport.close().catch(() => {
          // Abaikan error saat close — koneksi sudah ditutup client.
        });
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      // Pertahanan terakhir untuk level HTTP/transport — jangan biarkan
      // proses crash atau koneksi hang tanpa respons.
      if (!res.headersSent) {
        res.status(500).json({
          error: "internal_error",
          error_detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  // --- /health — tidak butuh auth (§6.5) ---
  app.get("/health", (req: Request, res: Response) => {
    let configOk = true;
    let configDetail: string | undefined;
    try {
      const config = getConfig();
      configOk = Boolean(config.tavilyApiKey) && config.geminiApiKeys.length > 0;
      if (!configOk) configDetail = "TAVILY_API_KEY atau GEMINI_API_KEYS kosong";
    } catch (err) {
      configOk = false;
      configDetail = err instanceof Error ? err.message : String(err);
    }

    res.status(200).json({
      status: "ok",
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString(),
      config_ok: configOk,
      ...(configDetail ? { config_detail: configDetail } : {}),
    });
  });

  // --- /test — dummy response, butuh auth (§6.5) ---
  app.get("/test", authMiddleware, (req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      message: "MCP server dapat diakses dan API key valid.",
      dummy_data: {
        example_worker_id: "gemini-1",
        example_api_key_index: 0,
        example_query: "contoh query dummy untuk testing",
      },
    });
  });

  registerFaviconRoute(app);
  registerRestRoutes(app);

  // --- 404 fallback untuk path tidak dikenal ---
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // --- Error handler terakhir (express 4 signature 4-arg wajib) ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!res.headersSent) {
      res.status(500).json({
        error: "internal_error",
        error_detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

export function startHttpServer(mcpServer: McpServer): ReturnType<Express["listen"]> {
  const config = getConfig();
  const app = createHttpApp(mcpServer);

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[journal-search-mcp] listening on port ${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`[journal-search-mcp] MCP endpoint: /mcp?key=***`);
  });

  server.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error(`[journal-search-mcp] HTTP server error:`, err);
    process.exit(1);
  });

  return server;
}
