import "dotenv/config";

/**
 * Semua env var di-load & divalidasi di sini, sekali saat startup.
 * Prinsip: gagal cepat (fail fast) & jelas untuk hal-hal yang fatal
 * (mis. MCP_API_KEY kosong), tapi toleran untuk hal yang punya
 * fallback wajar (mis. jumlah GEMINI_API_KEYS cuma 1 saat development).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new ConfigError(
      `Environment variable "${name}" wajib di-set dan tidak boleh kosong.`
    );
  }
  return value.trim();
}

function optionalEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(
      `Environment variable "${name}" harus berupa angka positif, dapat: "${raw}"`
    );
  }
  return parsed;
}

function optionalEnvString(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  return raw.trim();
}

function parseGeminiKeys(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") {
    throw new ConfigError(
      `Environment variable "GEMINI_API_KEYS" wajib di-set (minimal 1 key, dipisah koma).`
    );
  }
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keys.length === 0) {
    throw new ConfigError(
      `"GEMINI_API_KEYS" tidak boleh kosong setelah parsing (cek format, harus dipisah koma).`
    );
  }
  if (keys.length > 3) {
    // Bukan fatal, tapi beri warning karena spec mengasumsikan maksimal 3 key.
    // eslint-disable-next-line no-console
    console.warn(
      `[config] GEMINI_API_KEYS berisi ${keys.length} key, lebih dari 3 yang diasumsikan spec. ` +
        `Semua key tetap akan dipakai di pool, tapi perilaku belum tentu sesuai desain awal.`
    );
  }
  return keys;
}

interface AppConfig {
  port: number;
  tavilyApiKey: string;
  exaApiKey: string | null;
  geminiApiKeys: string[];
  geminiModel: string;
  maxCharsPerDoc: number;
  defaultMaxCandidates: number;
  rateLimit: {
    rpm: number;
    tpm: number;
    windowMs: number;
  };
  geminiKeyMaxWaitMs: number;
  mcpApiKey: string;
  mcpIconUrl: string | null;
}

function loadConfig(): AppConfig {
  // MCP_API_KEY wajib ada — fail-safe, server tidak boleh nyala tanpa auth (§10, §11).
  const mcpApiKey = requireEnv("MCP_API_KEY");
  const tavilyApiKey = requireEnv("TAVILY_API_KEY");
  const exaApiKey = optionalEnvString("EXA_API_KEY");
  const geminiApiKeys = parseGeminiKeys(process.env.GEMINI_API_KEYS);

  return {
    // Prioritas: PORT (Render) -> MCP_PORT (lokal) -> 3000 (§14.3)
    port: optionalEnvNumber("PORT", optionalEnvNumber("MCP_PORT", 3000)),
    tavilyApiKey,
    exaApiKey,
    geminiApiKeys,
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
    maxCharsPerDoc: optionalEnvNumber("MAX_CHARS_PER_DOC", 15_000),
    defaultMaxCandidates: optionalEnvNumber("DEFAULT_MAX_CANDIDATES", 5),
    rateLimit: {
      rpm: optionalEnvNumber("RATE_LIMIT_RPM", 15),
      tpm: optionalEnvNumber("RATE_LIMIT_TPM", 250_000),
      windowMs: 60_000,
    },
    geminiKeyMaxWaitMs: optionalEnvNumber("GEMINI_KEY_MAX_WAIT_MS", 90_000),
    mcpApiKey,
    mcpIconUrl: process.env.MCP_ICON_URL?.trim() || null,
  };
}

let cachedConfig: AppConfig | null = null;

/**
 * getConfig() dipanggil lazily (bukan top-level side effect) supaya:
 * - error config yang fatal bisa ditangkap secara eksplisit di index.ts
 *   dengan process.exit(1) dan pesan yang jelas, bukan unhandled exception acak.
 * - modul lain (tools/services) bisa import { getConfig } tanpa memicu
 *   validasi env berulang kali (di-cache setelah pertama kali sukses).
 */
export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = loadConfig();
  return cachedConfig;
}

export type { AppConfig };
