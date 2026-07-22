import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHttpApp } from "../httpServer.js";
import { getConfig } from "../../config.js";

// We need to load env before config reads it
import "../../config.js";

let server: Server;
let baseUrl: string;
let config: ReturnType<typeof getConfig>;

beforeAll(async () => {
  config = getConfig();

  // Register one dummy tool so the MCP server has at least 1 tool registered
  // (otherwise listTools returns empty and we cannot test tool_list response)
  const mcpServer = new McpServer({
    name: "test-server",
    version: "0.0.0",
  });
  mcpServer.tool("test_tool", "a dummy tool for testing", async () => ({
    content: [{ type: "text" as const, text: "ok" }],
  }));

  const app = createHttpApp(mcpServer);

  // Start on random port
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
}, 10_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function authHeaders() {
  return { "Content-Type": "application/json" };
}

function authUrl(path: string) {
  return `${baseUrl}${path}?key=${config.mcpApiKey}`;
}

// ============================================================
// Health endpoint (no auth required)
// ============================================================
describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("uptime_seconds");
    expect(body).toHaveProperty("config_ok");
  });
});

// ============================================================
// Test endpoint
// ============================================================
describe("GET /test", () => {
  it("returns ok with valid API key", async () => {
    const res = await fetch(authUrl("/test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("returns 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/test`);
    expect(res.status).toBe(401);
  });
});

// ============================================================
// POST /api/analyze-journal-standard — error paths
// ============================================================
describe("POST /api/analyze-journal-standard", () => {
  it("returns 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/api/analyze-journal-standard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/test.pdf", query: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns invalid_input for missing query", async () => {
    const res = await fetch(authUrl("/api/analyze-journal-standard"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/test.pdf" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
  });

  it("returns not_a_valid_pdf for non-PDF URL", async () => {
    const res = await fetch(authUrl("/api/analyze-journal-standard"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/not-a-pdf",
        query: "fisika kuantum",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("is_valid_pdf", false);
    expect(body).toHaveProperty("journal_title", null);
    expect(body).toHaveProperty("apa_citation", null);
  });
});

// ============================================================
// POST /api/analyze-journal-custom
// ============================================================
describe("POST /api/analyze-journal-custom", () => {
  it("returns invalid_input for empty url", async () => {
    const res = await fetch(authUrl("/api/analyze-journal-custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "", query: "test" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
  });
});

// ============================================================
// POST /api/verify-pdf — error path
// ============================================================
describe("POST /api/verify-pdf", () => {
  it("returns 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/api/verify-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/test.pdf" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns is_pdf false for non-PDF URL", async () => {
    const res = await fetch(authUrl("/api/verify-pdf"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/not-pdf" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("is_pdf", false);
  });
});

// ============================================================
// POST /api/tavily-search — error path (no API key passed)
// ============================================================
describe("POST /api/tavily-search", () => {
  it("returns 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/api/tavily-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================
// POST /api/search-and-check-journals — error paths
// ============================================================
describe("POST /api/search-and-check-journals", () => {
  it("returns 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/api/search-and-check-journals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "fisika kuantum" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns invalid_input for missing query", async () => {
    const res = await fetch(authUrl("/api/search-and-check-journals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
  });

  it("returns results (or Tavily error) array with valid query", { timeout: 30_000 }, async () => {
    const res = await fetch(authUrl("/api/search-and-check-journals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "fisika kuantum",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // If Tavily returns error, it's acceptable; otherwise verify structure
    if (body.error) {
      expect(["upstream_search_failed", "invalid_input"]).toContain(body.error);
    } else {
      expect(Array.isArray(body.results)).toBe(true);
      expect(body).toHaveProperty("total_candidates_checked");
    }
  });
});

// ============================================================
// MCP endpoint (/mcp)
// ============================================================
describe("MCP /mcp endpoint", () => {
  const mcpUrl = () => authUrl("/mcp");
  const mcpHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  /**
   * Parse MCP SSE response: extract JSON from `event: message\ndata: {...}\n\n`
   */
  function parseSseJson(text: string): Record<string, unknown> {
    const dataMatch = text.match(/^data: (.+)$/m);
    if (!dataMatch) throw new Error(`No SSE data found in: ${text}`);
    return JSON.parse(dataMatch[1]);
  }

  it("returns 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("responds to initialize with protocol version", async () => {
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    // Response is SSE: event: message\ndata: {...}\n\n
    const text = await res.text();
    expect(text).toContain("event: message");
    expect(text).toContain("data: ");

    const body = parseSseJson(text);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body).toHaveProperty("result");
    if (body.result) {
      const r = body.result as Record<string, unknown>;
      expect(r).toHaveProperty("protocolVersion");
      expect(r).toHaveProperty("capabilities");
      expect(r).toHaveProperty("serverInfo");
    }
  });

  it("responds to tools/list after initialization", async () => {
    // Initialize first
    await fetch(mcpUrl(), {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    // Send initialized notification
    const notifyRes = await fetch(mcpUrl(), {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    expect([200, 202]).toContain(notifyRes.status);

    // Request tools/list
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: message");

    const body = parseSseJson(text);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(2);
    expect(body).toHaveProperty("result");
    if (body.result) {
      const r = body.result as Record<string, unknown>;
      expect(r).toHaveProperty("tools");
      expect(Array.isArray(r.tools)).toBe(true);
    }
  });

  it("returns error for unknown method", async () => {
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "unknown_method_xyz",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: message");

    const body = parseSseJson(text);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(99);
    expect(body).toHaveProperty("error");
  });

  it("rejects with 415 when Content-Type is not application/json", async () => {
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream" },
      body: "not-json",
    });
    expect(res.status).toBe(415);
  });

  it("rejects with 406 when Accept header is missing", async () => {
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });
    expect(res.status).toBe(406);
  });
});

// ============================================================
// GET /api/tools
// ============================================================
describe("GET /api/tools", () => {
  it("returns list of available tools", async () => {
    const res = await fetch(authUrl("/api/tools"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tools");
    expect(body.tools.length).toBeGreaterThan(0);
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("analyze_journal_standard");
    expect(names).toContain("analyze_journal_custom");
    expect(names).toContain("search_and_check_journals");
  });
});

// ============================================================
// 404 for unknown routes
// ============================================================
describe("Unknown routes", () => {
  it("returns 404 for /api/nonexistent", async () => {
    const res = await fetch(authUrl("/api/nonexistent"));
    expect(res.status).toBe(404);
  });
});
