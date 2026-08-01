import { getConfig } from "../config.js";
import { DownloadSemaphore } from "./downloadSemaphore.js";

/**
 * Singleton instance dari DownloadSemaphore.
 * Lazy-init saat pertama kali diakses (supaya config sudah ter-load).
 */
let instance: DownloadSemaphore | null = null;

export function getDownloadSemaphore(): DownloadSemaphore {
  if (instance) return instance;
  const config = getConfig();
  instance = new DownloadSemaphore(
    config.maxConcurrentDownloads,
    config.maxTotalDownloadBytes,
    config.downloadSemaphoreTimeoutMs
  );
  return instance;
}
