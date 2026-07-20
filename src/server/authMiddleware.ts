import type { Request, Response, NextFunction } from "express";
import { getConfig } from "../config.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  let expectedKey: string;

  try {
    expectedKey = getConfig().mcpApiKey;
  } catch (err) {
    // Fail-safe: kalau config gagal load sama sekali di runtime (seharusnya
    // sudah dicegat di startup index.ts, tapi dijaga lagi di sini), tolak
    // request daripada membiarkan server berperilaku tidak terduga.
    res.status(500).json({ error: "server_misconfigured_missing_mcp_api_key" });
    return;
  }

  const providedKey = req.query.key;

  if (!expectedKey) {
    res.status(500).json({ error: "server_misconfigured_missing_mcp_api_key" });
    return;
  }

  if (typeof providedKey !== "string" || providedKey !== expectedKey) {
    res.status(401).json({ error: "invalid_or_missing_api_key" });
    return;
  }

  next();
}
