import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const NEW_ENV_VARS = [
  "MAX_CONCURRENT_DOWNLOADS",
  "MAX_TOTAL_DOWNLOAD_BYTES",
  "MAX_DOWNLOAD_BYTES_PER_FILE",
  "DOWNLOAD_SEMAPHORE_TIMEOUT_MS",
  "GEMINI_CALL_TIMEOUT_MS",
  "CIRCUIT_BREAKER_FAILURE_THRESHOLD",
  "CIRCUIT_BREAKER_COOLDOWN_MS",
];

const REQUIRED_ENV = ["MCP_API_KEY", "TAVILY_API_KEY", "GEMINI_API_KEYS"];

let savedEnv: Record<string, string | undefined> = {};

/** Load modul config fresh dari module registry — class ConfigError-nya juga fresh. */
async function freshConfigModule() {
  vi.resetModules();
  vi.doUnmock("../../config.js");
  return import("../../config.js");
}

beforeEach(() => {
  savedEnv = {};
  for (const key of [...NEW_ENV_VARS, ...REQUIRED_ENV]) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Required env minimal supaya loadConfig() tidak fail
  process.env.MCP_API_KEY = "test-mcp-key";
  process.env.TAVILY_API_KEY = "test-tavily-key";
  process.env.GEMINI_API_KEYS = "test-gemini-key";
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

describe("config: env baru (semaphore, timeout, circuit breaker)", () => {
  it("memakai nilai default saat env kosong", async () => {
    const { getConfig } = await freshConfigModule();
    const config = getConfig();
    expect(config.maxConcurrentDownloads).toBe(3);
    expect(config.maxTotalDownloadBytes).toBe(100 * 1024 * 1024);
    expect(config.maxDownloadBytesPerFile).toBe(20 * 1024 * 1024);
    expect(config.downloadSemaphoreTimeoutMs).toBe(30_000);
    expect(config.geminiCallTimeoutMs).toBe(15_000);
    expect(config.circuitBreakerFailureThreshold).toBe(3);
    expect(config.circuitBreakerCooldownMs).toBe(60_000);
  });

  it("membaca override dari env", async () => {
    process.env.MAX_CONCURRENT_DOWNLOADS = "5";
    process.env.MAX_TOTAL_DOWNLOAD_BYTES = "50000000";
    process.env.MAX_DOWNLOAD_BYTES_PER_FILE = "1000000";
    process.env.DOWNLOAD_SEMAPHORE_TIMEOUT_MS = "5000";
    process.env.GEMINI_CALL_TIMEOUT_MS = "8000";
    process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD = "7";
    process.env.CIRCUIT_BREAKER_COOLDOWN_MS = "120000";

    const { getConfig } = await freshConfigModule();
    const config = getConfig();
    expect(config.maxConcurrentDownloads).toBe(5);
    expect(config.maxTotalDownloadBytes).toBe(50_000_000);
    expect(config.maxDownloadBytesPerFile).toBe(1_000_000);
    expect(config.downloadSemaphoreTimeoutMs).toBe(5_000);
    expect(config.geminiCallTimeoutMs).toBe(8_000);
    expect(config.circuitBreakerFailureThreshold).toBe(7);
    expect(config.circuitBreakerCooldownMs).toBe(120_000);
  });

  it("nilai invalid (0) -> ConfigError", async () => {
    process.env.MAX_CONCURRENT_DOWNLOADS = "0";
    const mod = await freshConfigModule();
    expect(() => mod.getConfig()).toThrow(mod.ConfigError);
  });

  it("nilai invalid (negatif) -> ConfigError", async () => {
    process.env.GEMINI_CALL_TIMEOUT_MS = "-5";
    const mod = await freshConfigModule();
    expect(() => mod.getConfig()).toThrow(mod.ConfigError);
  });

  it("nilai invalid (bukan angka) -> ConfigError", async () => {
    process.env.CIRCUIT_BREAKER_COOLDOWN_MS = "abc";
    const mod = await freshConfigModule();
    expect(() => mod.getConfig()).toThrow(mod.ConfigError);
  });
});
