import type { Express } from "express";
import { getConfig } from "../config.js";

const FAVICON_FETCH_TIMEOUT_MS = 10_000;

export function registerFaviconRoute(app: Express): void {
  app.get(["/favicon.ico", "/favicon.png"], async (req, res) => {
    const config = getConfig();

    if (!config.mcpIconUrl) {
      // Tidak fatal — cuma tidak ada icon custom yang dikonfigurasi.
      res.status(404).json({ error: "mcp_icon_url_not_configured" });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FAVICON_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(config.mcpIconUrl, { signal: controller.signal });
      if (!response.ok) {
        res.status(502).json({ error: "favicon_fetch_failed" });
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader("Content-Type", response.headers.get("content-type") ?? "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400"); // cache 1 hari
      res.status(200).send(buffer);
    } catch (err) {
      res.status(502).json({ error: "favicon_fetch_failed" });
    } finally {
      clearTimeout(timer);
    }
  });
}
