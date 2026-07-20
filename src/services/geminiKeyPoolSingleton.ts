import { getConfig } from "../config.js";
import { GeminiKeyPool } from "./geminiKeyPool.js";

let instance: GeminiKeyPool | null = null;

function ensureInstance(): GeminiKeyPool {
  if (!instance) {
    const config = getConfig();
    instance = new GeminiKeyPool(config.geminiApiKeys, config.rateLimit);
  }
  return instance;
}

/**
 * Lazy singleton accessor. Dipakai sebagai objek dengan method yang sama
 * seperti GeminiKeyPool, tapi instansiasi sebenarnya ditunda sampai
 * pemanggilan pertama (setelah getConfig() sudah divalidasi di index.ts).
 */
export const geminiKeyPool = {
  acquire: (estimatedTokens: number, maxWaitMs?: number) =>
    ensureInstance().acquire(estimatedTokens, maxWaitMs),
  getStats: () => ensureInstance().getStats(),
  get size(): number {
    return ensureInstance().size;
  },
};
