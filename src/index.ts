import { getConfig, ConfigError } from "./config.js";
import { buildMcpServer } from "./mcpServer.js";
import { startHttpServer } from "./server/httpServer.js";

function main(): void {
  // 1. Validasi env vars di awal, fail fast dengan pesan jelas (§10).
  try {
    getConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // eslint-disable-next-line no-console
      console.error(`[journal-search-mcp] FATAL config error: ${err.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.error(`[journal-search-mcp] FATAL unexpected error saat load config:`, err);
    }
    process.exit(1);
  }

  // 2. Build MCP server (registrasi semua tools).
  let mcpServer;
  try {
    mcpServer = buildMcpServer();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[journal-search-mcp] FATAL gagal membangun MCP server:`, err);
    process.exit(1);
    return;
  }

  // 3. Start HTTP server.
  startHttpServer(mcpServer);
}

// --- Global safety nets ---
// Server ini sebaiknya tidak pernah crash karena error tak tertangani dari satu
// request/tool call. Semua error tool sudah dibungkus jadi JSON di layer
// masing-masing (§11), tapi ini pertahanan terakhir supaya proses tetap hidup
// dan log tetap informatif kalau ada bug yang lolos.
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[journal-search-mcp] uncaughtException:", err);
  // Sengaja TIDAK process.exit() di sini — server HTTP tetap harus melayani
  // request lain. Kalau proses benar-benar dalam state korup, platform
  // (Render) akan restart lewat health check yang gagal.
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[journal-search-mcp] unhandledRejection:", reason);
});

main();
