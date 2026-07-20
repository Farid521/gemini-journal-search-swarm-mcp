# Journal Search Agent Swarm — MCP Server Specs

## 1. Overview

Sistem ini adalah **MCP Server** (Node.js + TypeScript) yang dipanggil oleh Claude Sonnet 5 (di luar server, sebagai MCP client/orchestrator) untuk melakukan pencarian dan verifikasi jurnal akademik dalam bentuk PDF.

Prinsip desain utama: **Claude tidak pernah membaca isi dokumen mentah.** Semua pembacaan/pemahaman konten PDF didelegasikan ke sub-agent Gemini Flash Lite, yang mengembalikan hasil dalam JSON pendek. Claude hanya bertugas merumuskan query, memilih tool, dan menafsirkan hasil JSON pendek tersebut.

### 1.1 Komponen Utama

| Komponen | Peran |
|---|---|
| Claude Sonnet 5 | Orchestrator / MCP client. Merumuskan query, memanggil tools, menafsirkan hasil. |
| MCP Server (Node.js/TS) | Menjembatani Claude dengan Tavily API dan Gemini workers. |
| Gemini Worker 1 & 2 | Deterministik. Prompt tetap: cek apakah dokumen memuat penjelasan dasar + persamaan-persamaan dasar sesuai query. Dipilih round-robin. |
| Gemini Worker 3 | Prompt default sama seperti worker 1/2, tapi bisa di-override oleh Claude lewat parameter tool (`custom_instruction`). |
| Magic Bytes Checker | Modul internal (bukan tool Tavily) untuk memverifikasi bahwa URL benar-benar file PDF sebelum diproses lebih jauh. |
| Tavily Search/Extract/Crawl | Exposed sebagai tools mentah yang bisa dipanggil Claude langsung untuk pencarian umum. |
| Lightpanda Worker (Worker 4) | **Belum diimplementasikan.** Didokumentasikan sebagai non-goal fase ini (lihat §9). |

### 1.2 Alur Utama (flow yang Anda deskripsikan)

```
Claude susun query
   │
   ▼
MCP tool: search_and_check_journals(query, ...)
   │
   ▼
Tavily Search (dapat list kandidat URL)
   │
   ▼
untuk setiap kandidat URL:
   ├─ Magic Bytes Check → apakah benar PDF?
   │     └─ bukan PDF → skip / tandai invalid
   ├─ Download & extract teks (maks N karakter, default 15.000)
   ├─ Kirim ke Gemini Worker (round-robin worker 1/2, prompt deterministik)
   │     → cek: ada penjelasan dasar? ada persamaan dasar? relevan dengan query?
   ▼
Aggregasi hasil → JSON pendek per kandidat
   │
   ▼
Return ke Claude (JSON pendek, bukan isi dokumen)
```

Selain tool komposit ini, tersedia juga tools granular (Tavily search/extract/crawl, verify_pdf, analyze_journal_standard, analyze_journal_custom) supaya Claude bisa menyusun alur sendiri kalau perlu kontrol lebih halus.

---

## 2. Tech Stack

- **Runtime**: Node.js 20+
- **Bahasa**: TypeScript (compile ke `dist/` via `tsc`)
- **MCP SDK**: `@modelcontextprotocol/sdk` — pakai **Streamable HTTP transport** (`StreamableHTTPServerTransport`), bukan stdio, supaya server bisa dipanggil cukup lewat satu URL (lihat §6.4).
- **HTTP framework**: `express` (untuk mount MCP transport + middleware auth query param)
- **Validasi schema**: `zod` (dipakai untuk tool input/output schema, sekaligus generate JSON schema untuk MCP tool definitions)
- **HTTP client**: `undici` atau `node-fetch` bawaan (Node 20 sudah punya global `fetch`)
- **PDF text extraction**: `pdf-parse` (ringan, cukup untuk ekstraksi teks; kalau ke depan perlu OCR/scan support baru pertimbangkan ganti)
- **Gemini SDK**: `@google/generative-ai` (Google AI Studio, model `gemini-3.1-flash-lite`)
- **Tavily**: REST API langsung (tidak perlu SDK resmi, cukup `fetch` ke `https://api.tavily.com/*`)
- **Env config**: `dotenv`

---

## 3. Struktur Folder

```
journal-search-mcp/
├── src/
│   ├── index.ts                     # entrypoint: setup express, mount MCP transport, register semua tools
│   ├── server/
│   │   ├── httpServer.ts            # express app + StreamableHTTPServerTransport wiring (§6.4)
│   │   ├── authMiddleware.ts        # cek query param ?key= terhadap MCP_API_KEY (§6.4)
│   │   └── favicon.ts               # proxy /favicon.ico + /favicon.png (§6.6)
│   ├── config.ts                    # load & validate env vars
│   ├── types.ts                     # shared TypeScript types
│   │
│   ├── tools/                       # 1 file = 1 MCP tool (handler + zod schema)
│   │   ├── tavilySearch.ts
│   │   ├── tavilyExtract.ts
│   │   ├── tavilyCrawl.ts
│   │   ├── verifyPdf.ts
│   │   ├── analyzeJournalStandard.ts
│   │   ├── analyzeJournalCustom.ts
│   │   └── searchAndCheckJournals.ts   # tool komposit (§1.2)
│   │
│   ├── services/
│   │   ├── tavilyClient.ts          # wrapper fetch ke Tavily API
│   │   ├── geminiClient.ts          # wrapper call Gemini API
│   │   ├── pdfMagicBytes.ts         # cek header %PDF-
│   │   ├── pdfTextExtractor.ts      # download + pdf-parse, truncate ke MAX_CHARS
│   │   ├── rateLimiter.ts           # sliding window reserve→settle→release, 1 instance per API key
│   │   ├── geminiKeyPool.ts         # rotasi 3 API key + fallback wait (§6.2)
│   │   └── workerPool.ts            # round-robin logic worker role 1/2 (prompt), dedicated role 3
│   │
│   ├── prompts/
│   │   ├── deterministicCheckPrompt.ts   # prompt tetap worker 1 & 2 (dan default worker 3)
│   │   └── buildCustomPrompt.ts          # gabungkan default + custom_instruction dari Claude
│   │
│   └── schemas/
│       └── toolSchemas.ts           # zod schemas untuk semua tool input/output
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 4. Modul: Magic Bytes Checker

**File**: `src/services/pdfMagicBytes.ts`

Tidak menggunakan `curl`/`xxd` seperti skill lama Anda (itu untuk lingkungan shell/agent Claude Code) — di sini murni Node.js karena berjalan sebagai service:

1. Request ke URL dengan header `Range: bytes=0-1023` (ambil 1KB pertama saja, hemat bandwidth).
2. Kalau server tidak mendukung `Range` (status bukan 206), fallback: `fetch` biasa lalu baca stream, potong di 1024 byte pertama, `abort()` koneksi.
3. Cek 5 byte pertama == `25 50 44 46 2D` (`%PDF-` dalam hex).
4. Return:
```ts
interface MagicBytesResult {
  url: string;
  is_pdf: boolean;
  detected_signature: string; // hex 5 byte pertama, untuk debug
  http_status: number;
  content_type_header?: string; // untuk cross-check, tapi TIDAK dipakai sebagai sumber kebenaran utama
}
```

Catatan penting: `Content-Type` header dari server **tidak bisa dipercaya sepenuhnya** (banyak server salah set atau generic `application/octet-stream`) — itu kenapa perlu magic bytes sebagai ground truth, bukan cuma cross-check.

Timeout: 10 detik per request, dengan 1x retry kalau timeout/connection error.

---

## 5. Modul: Gemini Worker Pool

**File**: `src/services/workerPool.ts`

```ts
type WorkerId = "gemini-1" | "gemini-2" | "gemini-3";

interface WorkerPool {
  getStandardWorker(): WorkerId;  // round-robin antara gemini-1 dan gemini-2
  getCustomWorker(): WorkerId;    // selalu gemini-3
}
```

- Worker 1 & 2: dipanggil hanya lewat `analyze_journal_standard` / `search_and_check_journals`. Prompt **tidak bisa diubah** dari luar (hardcoded di `deterministicCheckPrompt.ts`).
- Worker 3: dipanggil lewat `analyze_journal_custom`. Kalau Claude tidak mengirim `custom_instruction`, pakai prompt default yang **sama persis** dengan worker 1/2 (via `buildCustomPrompt.ts` yang fallback ke default kalau param kosong).
- Setiap worker (gemini-1/2/3) punya rate limiter sendiri (§6) supaya kalau satu worker kena limit, dua lainnya tetap jalan.

### 5.1 Prompt Deterministik (Worker 1 & 2, default Worker 3)

Kriteria pengecekan (silakan sesuaikan detail rubrik dengan yang sudah Anda punya sebelumnya — di sini saya asumsikan versi ringkas mengikuti pola 4-kriteria "basic level" yang pernah Anda buat):

**Contoh konkret supaya kriteria di atas jelas** — misal QUERY = "hukum Ohm":
- `has_basic_explanation: true` kalau dokumen menjelaskan **apa itu** hukum Ohm (misal: hubungan antara tegangan, arus, dan hambatan pada suatu konduktor), bukan cuma menyebut istilahnya sekilas di abstrak/daftar pustaka.
- `has_basic_equations: true` kalau dokumen memuat persamaan dasarnya, misal **V = IR** (atau bentuk turunannya seperti I = V/R, R = V/I).
- Kalau dokumen cuma menyebut "hukum Ohm" sebagai referensi tanpa penjelasan konsep maupun persamaan sama sekali → kedua field di atas `false`, meski `is_relevant` bisa saja tetap `true`.

Contoh ini dimasukkan ke dalam prompt sebagai bagian dari instruksi (few-shot), supaya worker tidak salah interpretasi standar "basic" untuk topik lain di luar contoh ini:

```
Anda menerima:
- QUERY: topik yang dicari user
- DOCUMENT_TEXT: potongan teks dokumen (maks {MAX_CHARS} karakter)

Tugas: tentukan apakah dokumen ini relevan dengan QUERY dan memuat MINIMAL:
1. has_basic_explanation: penjelasan konsep dasar terkait QUERY (bukan cuma abstrak/referensi)
2. has_basic_equations: persamaan/rumus dasar yang relevan dengan QUERY (jika topik memang bersifat kuantitatif; jika topik non-matematis, field ini boleh true jika ada definisi formal/notasi setara)
3. is_relevant: dokumen memang membahas QUERY, bukan cuma menyebut sekilas

Contoh: jika QUERY = "hukum Ohm", maka has_basic_explanation harus true HANYA jika dokumen
menjelaskan apa itu hukum Ohm (hubungan tegangan, arus, dan hambatan), dan has_basic_equations
harus true HANYA jika dokumen memuat persamaan dasarnya (misal V = IR). Menyebut "hukum Ohm"
sekilas tanpa penjelasan atau persamaan TIDAK memenuhi kriteria ini.

Jawab HANYA dalam JSON valid, tanpa markdown, tanpa penjelasan tambahan, format:
{
  "is_relevant": boolean,
  "has_basic_explanation": boolean,
  "has_basic_equations": boolean,
  "confidence": "high" | "medium" | "low",
  "reason": "<maks 150 karakter, alasan singkat>"
}
```

**Catatan untuk coding agent**: rubrik detail di atas adalah asumsi/starting point, dan contoh hukum Ohm di dalamnya cuma satu ilustrasi. Farid sudah punya rubrik 4-kriteria "basic level academic content judgment" dari sistem sebelumnya — kalau ada, gunakan itu sebagai pengganti draft prompt ini (termasuk contoh few-shot-nya, sesuaikan/ganti dengan contoh yang relevan ke rubrik aslinya).

### 5.2 Custom Prompt (Worker 3)

```ts
function buildCustomPrompt(query: string, documentText: string, customInstruction?: string): string {
  const instructionBlock = customInstruction?.trim()
    ? customInstruction
    : DEFAULT_DETERMINISTIC_INSTRUCTION; // sama dengan §5.1

  return `${instructionBlock}\n\nQUERY: ${query}\n\nDOCUMENT_TEXT:\n${documentText}`;
}
```

Output schema **tetap dipaksa sama** (JSON pendek di atas) apapun custom_instruction-nya — supaya Claude tidak perlu handle format response yang tidak terduga. Kalau Claude perlu field tambahan di luar skema standar, `analyze_journal_custom` punya field opsional `extra_fields_requested: string[]` yang akan ditambahkan ke JSON output sebagai key tambahan bertipe string (best-effort, tidak divalidasi ketat).

---

## 6. Rate Limiting & Multi API Key Pool

### 6.1 Prinsip dasar

Rate limit (RPM/TPM) itu melekat **per API key**, bukan per worker role. Jadi worker role (`gemini-1`/`gemini-2`/`gemini-3`, yang menentukan prompt) dan API key (yang menentukan kuota) adalah dua sumbu independen. Setiap kali ada Gemini call — dari worker mana pun — call itu akan "meminjam" satu API key dari **pool 3 key** yang tersedia, bukan terikat ke satu key tetap.

Tetap reuse pola **sliding window reserve → settle → release** per key:

- Sebelum call ke Gemini API: `reserve(estimatedTokens)` pada key yang dipilih — cek kuota RPM & TPM key tsb, kalau tidak cukup → key tsb dianggap "busy", coba key berikutnya.
- Setelah dapat response: `settle(actualTokens)` — sesuaikan reservasi dengan token aktual (dari `usageMetadata`).
- Kalau call gagal sebelum sempat kirim: `release(estimatedTokens)` — kembalikan kuota yang sudah direservasi ke key tsb.

Konfigurasi (default per key, sesuaikan dengan tier API key Anda):
```ts
const RATE_LIMIT_CONFIG = {
  rpm: 15,        // requests per minute, PER API KEY
  tpm: 250_000,   // tokens per minute, PER API KEY
  windowMs: 60_000,
};
```

Implementasi: `src/services/rateLimiter.ts`, class `SlidingWindowLimiter`, satu instance per API key (bukan per worker role lagi).

### 6.2 Key Pool & Fallback Wait — Flow sesuai kebutuhan Anda

**File**: `src/services/geminiKeyPool.ts`

Flow yang diminta:
```
coba key-1
  └─ rate limited? → coba key-2
        └─ rate limited? → coba key-3
              └─ rate limited juga (ketiga key exhausted)?
                    → WAIT sampai key tercepat yang free (dari salah satu 3 key)
                    → ulangi dari key-1 lagi
                    → kalau key-1 ternyata masih belum bisa (window belum reset saat retry),
                      lanjut ke key-2, key-3, dst (siklus berulang)
  → kalau total wait sudah melebihi batas maksimum → return error, JANGAN hang selamanya
```

Implementasi (pseudocode):

```ts
interface KeyState {
  apiKey: string;
  index: number;               // 0, 1, 2
  limiter: SlidingWindowLimiter;
}

class GeminiKeyPool {
  private keys: KeyState[]; // urutan tetap: key-1, key-2, key-3 (dari env, urutan dipertahankan)

  async acquire(estimatedTokens: number, maxWaitMs = 90_000): Promise<AcquiredKey> {
    const startedAt = Date.now();

    while (true) {
      // selalu mulai dari key-1, urut sampai key-3 (sesuai flow yang diminta)
      for (const state of this.keys) {
        const reservation = state.limiter.tryReserve(estimatedTokens);
        if (reservation.ok) {
          return {
            apiKey: state.apiKey,
            keyIndex: state.index,
            settle: reservation.settle,
            release: reservation.release,
          };
        }
      }

      // ketiga key sedang rate limited → hitung waktu tunggu tercepat
      const waitMs = Math.min(
        ...this.keys.map((s) => s.limiter.msUntilAvailable(estimatedTokens))
      );

      if (Date.now() - startedAt + waitMs > maxWaitMs) {
        throw new AllKeysRateLimitedError(
          `Semua ${this.keys.length} API key rate limited, sudah menunggu ${Date.now() - startedAt}ms`
        );
      }

      await sleep(waitMs + jitter(200)); // +jitter kecil biar tidak thundering herd kalau ada banyak call paralel
      // loop `while(true)` mengulang, otomatis mulai lagi dari key-1
    }
  }
}
```

Catatan implementasi:
- `msUntilAvailable(estimatedTokens)` pada `SlidingWindowLimiter`: hitung kapan window paling lama akan punya slot cukup (baik dari sisi RPM count maupun TPM sum), return 0 kalau sudah available sekarang.
- `jitter(200)` supaya kalau ada beberapa call paralel yang sama-sama menunggu, mereka tidak semua bangun di milidetik yang sama dan langsung tabrakan lagi.
- `maxWaitMs` default 90 detik (bisa diatur via env `GEMINI_KEY_MAX_WAIT_MS`) — ini **hard limit** supaya kalau memang API Google down/quota habis total, tool tidak hang tanpa batas dan Claude tetap dapat respons (berupa error JSON, lihat §11).
- Setiap `analyze_journal_standard` / `analyze_journal_custom` call akan memanggil `keyPool.acquire()` satu kali di awal, lepas dari worker role mana yang dipakai untuk prompt-nya.

### 6.3 Interaksi dengan Worker Role

Worker role (`gemini-1`/`gemini-2`/`gemini-3`) tetap menentukan **prompt** yang dipakai (§5). API key yang dipakai untuk mengeksekusi call itu **independen**, ditentukan oleh `GeminiKeyPool.acquire()` di atas. Jadi kombinasinya bisa apa saja, misal: worker role `gemini-2` (prompt deterministik B) dieksekusi pakai API key index 2 (key ketiga) karena key pertama & kedua sedang penuh. Field `worker_id` di output tetap menunjukkan role/prompt (§5), sementara `api_key_index` (field baru, lihat §7.5) menunjukkan key mana yang benar-benar dipakai — berguna untuk debugging/observability, bukan untuk logic Claude.

### 6.4 HTTP Transport & Pemanggilan via URL + API Key

Server berjalan sebagai HTTP server (bukan stdio), supaya cara pakainya cukup: **satu URL + query param `key`**, tanpa perlu setup proses lokal/spawn command.

**Cara pemanggilan (contoh)**:
```
https://host-anda:PORT/mcp?key=API_MCP_VALUE_DARI_ENV
```

Config di Claude (misal `claude_desktop_config.json` atau setting MCP connector lain) tinggal isi URL di atas sebagai endpoint MCP server — tidak perlu command/args seperti stdio transport.

**Implementasi (`src/server/httpServer.ts`)**:

```ts
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authMiddleware } from "./authMiddleware";
import { mcpServer } from "../index"; // instance McpServer yang sudah register semua tools

const app = express();
app.use(express.json());

// auth dicek SEBELUM request masuk ke MCP transport handler
app.all("/mcp", authMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode, cukup untuk kasus ini
  });
  res.on("close", () => transport.close());
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(config.port, () => {
  console.log(`MCP server listening on port ${config.port}`);
});
```

> **Catatan Render**: Render menginjeksikan env var `PORT` secara otomatis dan mengharuskan aplikasi listen di port tersebut — jangan hardcode port lain. Di `config.ts`, resolve port dengan `process.env.PORT ?? process.env.MCP_PORT ?? 3000`, sehingga `PORT` dari Render selalu diprioritaskan. Detail lengkap di §14.

**Auth middleware (`src/server/authMiddleware.ts`)**:

```ts
import type { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const providedKey = req.query.key;
  const expectedKey = process.env.MCP_API_KEY;

  if (!expectedKey) {
    // fail-safe: kalau env tidak di-set, server TOLAK semua request (bukan malah terbuka bebas)
    return res.status(500).json({ error: "server_misconfigured_missing_mcp_api_key" });
  }

  if (providedKey !== expectedKey) {
    return res.status(401).json({ error: "invalid_or_missing_api_key" });
  }

  next();
}
```

**Env var terkait** (lihat juga §10):
```env
MCP_API_KEY=isi_dengan_random_string_panjang
MCP_PORT=3000
```

**Catatan keamanan (penting, silakan pertimbangkan)**:
- Query param di URL rawan tercatat di access log server, browser history, atau log proxy/CDN di depan server ini. Untuk penggunaan testing/development seperti sekarang ini cukup aman, tapi kalau nanti dipakai lebih serius/expose ke publik, pertimbangkan pindah ke header `Authorization: Bearer <key>` yang tidak ke-log semudah itu. Saya tetap ikuti permintaan Anda (query param `?key=`) karena ini masih fase testing.
- Jalankan di belakang HTTPS (bukan HTTP polos) kalau server ini diakses lewat internet, supaya `key` di URL tidak lewat plain text di jaringan.
- `MCP_API_KEY` ini beda dengan `TAVILY_API_KEY`/`GEMINI_API_KEYS` — ini khusus untuk otentikasi **siapa yang boleh memanggil MCP server ini**, bukan kredensial ke layanan pihak ketiga.

### 6.5 Endpoint Tambahan: `/health` dan `/test`

Dua endpoint HTTP biasa (bukan tool MCP), dipasang di `httpServer.ts` yang sama, untuk cek cepat server hidup dan koneksi/auth benar tanpa perlu client MCP penuh.

**`GET /health`** — cek apakah sistem hidup (untuk monitoring, load balancer, atau sekadar curl manual). **Tidak butuh auth** (`?key=`) — ini konvensi umum health check, supaya tooling monitoring tidak perlu tahu API key.

```ts
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime_seconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
```

Response contoh:
```json
{
  "status": "ok",
  "uptime_seconds": 3721.4,
  "timestamp": "2026-07-20T09:15:00.000Z"
}
```

Opsional (kalau mau lebih berguna, bukan wajib fase ini): tambahkan pengecekan ringan apakah `TAVILY_API_KEY` dan `GEMINI_API_KEYS` ter-load dari env (bukan test call sungguhan ke API-nya, cukup cek non-empty), supaya `/health` juga bisa mendeteksi kasus "server hidup tapi config-nya salah/lupa di-set".

**`GET /test`** — return dummy response, untuk verifikasi bahwa URL + `?key=` yang dipakai sudah benar dan bisa nembus `authMiddleware`. **Butuh auth** (`?key=`, middleware sama seperti `/mcp`) — karena tujuannya justru untuk mengetes apakah key yang Anda pakai valid.

```ts
app.get("/test", authMiddleware, (req, res) => {
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
```

Karena pakai `authMiddleware`, kalau `?key=` salah/hilang, `/test` akan otomatis balas `401 invalid_or_missing_api_key` sesuai §11 — jadi sekaligus jadi cara tercepat untuk verifikasi auth dari luar tanpa perlu client MCP.

Kedua endpoint ini didaftarkan di `httpServer.ts`, sebelum atau sesudah route `/mcp` (urutan tidak masalah karena path berbeda).

### 6.6 Custom Icon — SEP-973 `icons` field + `/favicon.ico`

Dua mekanisme dipasang sekaligus untuk custom icon server, karena per riset terbaru (Juli 2026) **Claude.ai/Claude Desktop belum menampilkan icon custom untuk custom connector** meski server sudah kirim field yang benar (masih open issue di tracker Anthropic). Jadi kedua mekanisme ini sifatnya **forward-compatible** — sudah benar sesuai spec, siap begitu Claude merender-nya, tapi jangan berharap logo langsung muncul di UI sekarang.

**Sumber gambar** (dikonfigurasi via env, bukan hardcode — lihat §10):
```
https://oqmigmphfdwemlejkhyw.supabase.co/storage/v1/object/public/pageindex-books-test-A-001/Walter_White_S5B.png
```

**a) SEP-973 `icons` di `serverInfo`**

Di `index.ts`, saat instansiasi `McpServer`, tambahkan field `icons` (array, sesuai spec MCP versi ≥2025-11-25):

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config";

export const mcpServer = new McpServer({
  name: "journal-search-mcp",
  version: "1.0.0",
  icons: [
    {
      src: config.mcpIconUrl,
      mimeType: "image/png",
      sizes: ["any"],
    },
  ],
});
```

**b) `/favicon.ico` — proxy, bukan redirect**

**File**: `src/server/favicon.ts`

Proxy (fetch ulang lalu forward bytes) dipilih daripada `res.redirect()`, karena sebagian client/crawler tidak mengikuti redirect untuk favicon:

```ts
import type { Express } from "express";
import { config } from "../config";

export function registerFaviconRoute(app: Express) {
  app.get(["/favicon.ico", "/favicon.png"], async (req, res) => {
    try {
      const response = await fetch(config.mcpIconUrl);
      if (!response.ok) {
        return res.status(502).json({ error: "favicon_fetch_failed" });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader("Content-Type", response.headers.get("content-type") ?? "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400"); // cache 1 hari, hemat fetch berulang ke Supabase
      res.status(200).send(buffer);
    } catch (err) {
      res.status(502).json({ error: "favicon_fetch_failed" });
    }
  });
}
```

Didaftarkan di `httpServer.ts` bersama route `/health` dan `/test`:
```ts
registerFaviconRoute(app);
```

**Catatan**:
- Kalau ke depan URL gambar berubah, tinggal ganti `MCP_ICON_URL` di `.env`, tidak perlu ubah kode.
- `sizes: ["any"]` dipakai karena kita tidak generate multi-resolusi icon (cukup satu file PNG apa adanya). Kalau nanti mau lebih rapi, bisa generate beberapa ukuran (16x16, 32x32, 128x128) dan isi array `icons` dengan beberapa entry.
- Endpoint `/favicon.ico` ini **tidak butuh auth** (`?key=`), sama seperti `/health` — favicon itu resource publik yang wajar diakses tanpa otentikasi (browser tab, dsb).

---

## 7. MCP Tools — Spesifikasi Lengkap

### 7.1 `tavily_search`
Pass-through langsung ke Tavily Search API. Hasil dikembalikan **langsung ke Claude tanpa lewat Gemini** (ini bukan bagian dari alur verifikasi PDF, cuma pencarian umum).

**Input**:
```ts
{
  query: string;
  max_results?: number;        // default 10
  search_depth?: "basic" | "advanced"; // default "basic"
  include_domains?: string[];
  exclude_domains?: string[];
}
```

**Output**: array hasil mentah dari Tavily (title, url, content snippet, score) — diteruskan apa adanya (mungkin di-trim field yang tidak perlu).

---

### 7.2 `tavily_extract`
Pass-through ke Tavily Extract API. Untuk kasus Claude ingin baca isi halaman web (bukan PDF jurnal) secara langsung — misal halaman index jurnal untuk cari link PDF.

**Input**: `{ urls: string[] }`
**Output**: array `{ url, raw_content, success }`

---

### 7.3 `tavily_crawl`
Pass-through ke Tavily Crawl API.

**Input**: `{ url: string; max_depth?: number; limit?: number; instructions?: string }`
**Output**: array halaman hasil crawl (url + content ringkas)

---

### 7.4 `verify_pdf`
Wrapper langsung ke modul magic bytes (§4), dipanggil standalone kalau Claude cuma perlu cek validitas URL tanpa analisis konten.

**Input**: `{ url: string }`
**Output**: `MagicBytesResult` (lihat §4)

---

### 7.5 `analyze_journal_standard`
Pipeline lengkap: verify PDF → extract text → kirim ke worker 1/2 (round-robin) → return JSON pendek.

**Input**:
```ts
{
  url: string;
  query: string;          // konteks pencarian, dipakai worker untuk cek relevansi
  max_chars?: number;     // default 15000
}
```

**Output**:
```ts
{
  url: string;
  is_valid_pdf: boolean;
  worker_id: "gemini-1" | "gemini-2";
  api_key_index: number | null;   // 0/1/2, key mana yang benar-benar dipakai (debug/observability, bukan untuk logic Claude)
  is_relevant: boolean;
  has_basic_explanation: boolean;
  has_basic_equations: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  error?: string;   // diisi kalau ada kegagalan di salah satu step (bukan PDF, extract gagal, semua key rate limited, dll)
}
```

Kalau `is_valid_pdf: false`, langsung short-circuit — tidak lanjut ke extract/Gemini, field analisis lain jadi `null`/omit, `error` diisi `"not_a_valid_pdf"`.

---

### 7.6 `analyze_journal_custom`
Sama seperti 7.5, tapi selalu pakai worker 3, dan terima `custom_instruction` opsional.

**Input**:
```ts
{
  url: string;
  query: string;
  custom_instruction?: string;   // kalau kosong, pakai prompt default (sama seperti standard)
  max_chars?: number;
  extra_fields_requested?: string[]; // lihat §5.2
}
```

**Output**: sama seperti 7.5 (`worker_id` selalu `"gemini-3"`), ditambah field-field dari `extra_fields_requested` kalau diminta.

---

### 7.7 `search_and_check_journals` (tool komposit — mengikuti flow §1.2)

**Input**:
```ts
{
  query: string;
  max_candidates?: number;   // default 5, batas jumlah URL dari Tavily yang diverifikasi
  search_depth?: "basic" | "advanced"; // diteruskan ke Tavily
}
```

**Proses internal**:
1. `tavily_search(query, max_results = max_candidates * 2)` — ambil lebih banyak kandidat dari yang dibutuhkan, karena sebagian akan gugur di magic bytes check.
2. Untuk tiap hasil (urut skor Tavily, stop begitu `max_candidates` yang **valid PDF** terkumpul, atau kandidat habis):
   - `verify_pdf`
   - kalau valid → `analyze_journal_standard` (round-robin worker 1/2, **diproses paralel** dengan `Promise.all` per-batch kecil, misal 2 sekaligus, supaya tidak membanjiri rate limiter)
3. Aggregasi ke satu array hasil.

**Output**:
```ts
{
  query: string;
  total_candidates_checked: number;
  results: Array<AnalyzeJournalStandardOutput>; // schema §7.5
}
```

Ini adalah tool yang **paling sering dipanggil Claude** — satu call, dapat verdict siap pakai untuk beberapa kandidat jurnal sekaligus, tanpa Claude pernah menyentuh isi PDF.

---

## 8. Contoh Output JSON (referensi cepat untuk coding agent)

```json
{
  "query": "persamaan Schrödinger bergantung waktu",
  "total_candidates_checked": 6,
  "results": [
    {
      "url": "https://example.edu/journal/quantum-intro.pdf",
      "is_valid_pdf": true,
      "worker_id": "gemini-1",
      "is_relevant": true,
      "has_basic_explanation": true,
      "has_basic_equations": true,
      "confidence": "high",
      "reason": "Memuat turunan persamaan Schrödinger bergantung waktu dengan penjelasan konsep dasar."
    },
    {
      "url": "https://example.com/blog-post",
      "is_valid_pdf": false,
      "worker_id": null,
      "is_relevant": null,
      "has_basic_explanation": null,
      "has_basic_equations": null,
      "confidence": null,
      "reason": null,
      "error": "not_a_valid_pdf"
    }
  ]
}
```

---

## 9. Non-Goals / Future Work (Fase ini TIDAK diimplementasikan)

- **Worker 4 (Lightpanda)**: Gemini Flash Lite dengan akses browser Lightpanda untuk kasus PDF yang butuh JS-rendering / halaman dinamis / login-wall. Sisakan slot di `workerPool.ts` (`getBrowserWorker()` return `not_implemented` error) supaya integrasi nanti tidak perlu refactor besar, tapi jangan implementasi logic-nya sekarang.
- Caching hasil analisis (biar re-query query yang sama tidak re-analisis dokumen yang sama) — bisa jadi optimasi lanjutan mengikuti pola cache/combinatorics yang sudah Anda punya di sistem lain.
- OCR untuk PDF hasil scan (sekarang asumsi PDF text-based, `pdf-parse` cukup).
- Multi-user session/auth per-user (sekarang cuma satu shared `MCP_API_KEY`, tidak ada konsep user berbeda dengan izin berbeda).

---

## 10. Environment Variables

```env
TAVILY_API_KEY=

# 3 API key Google, urutan dipertahankan (key-1, key-2, key-3), pisahkan dengan koma
GEMINI_API_KEYS=key1_disini,key2_disini,key3_disini

GEMINI_MODEL=gemini-3.1-flash-lite
MAX_CHARS_PER_DOC=15000
DEFAULT_MAX_CANDIDATES=5

# rate limit ini berlaku PER KEY, bukan total
RATE_LIMIT_RPM=15
RATE_LIMIT_TPM=250000

# batas maksimum menunggu (ms) sebelum key pool dianggap gagal total & return error
GEMINI_KEY_MAX_WAIT_MS=90000

# auth untuk memanggil MCP server ini sendiri (§6.4) — dipakai sebagai ?key=... di URL
MCP_API_KEY=isi_dengan_random_string_panjang
MCP_PORT=3000

# custom icon server (§6.6) — dipakai di SEP-973 icons field + /favicon.ico proxy
MCP_ICON_URL=https://oqmigmphfdwemlejkhyw.supabase.co/storage/v1/object/public/pageindex-books-test-A-001/Walter_White_S5B.png
```

Validasi di `config.ts`: kalau `GEMINI_API_KEYS` cuma berisi 1 key (misal saat development), sistem tetap jalan normal — key pool otomatis berperilaku seperti single-key. `config.ts` juga wajib exit dengan error jelas di startup kalau `MCP_API_KEY` tidak di-set — jangan biarkan server nyala tanpa auth.

---

## 11. Error Handling — Konvensi

Semua tool **tidak boleh throw ke MCP client mentah-mentah**. Bungkus semua error jadi bagian dari output JSON (`error: string`) dengan kode singkat, contoh:

- `"not_a_valid_pdf"`
- `"download_failed"`
- `"extract_text_failed"`
- `"gemini_invalid_json_response"` (kalau Gemini balas non-JSON — retry 1x dengan instruksi lebih tegas sebelum give up)
- `"all_keys_rate_limited"` — dilempar `GeminiKeyPool.acquire()` kalau sudah menunggu sampai `GEMINI_KEY_MAX_WAIT_MS` dan ketiga key masih penuh semua. Ini pengganti `"gemini_rate_limited"` lama — dengan key pool, rate limit dari 1-2 key seharusnya jarang sampai bocor ke Claude karena sudah di-retry otomatis di dalam `acquire()`. Error ini cuma muncul kalau **semua** key habis dan sudah melewati batas tunggu.

Khusus level HTTP (bukan level tool JSON, tapi response HTTP dari `authMiddleware`):
- `401 invalid_or_missing_api_key` — `?key=` di URL tidak cocok/tidak ada
- `500 server_misconfigured_missing_mcp_api_key` — `MCP_API_KEY` tidak di-set di server (fail-safe, server harus nolak bukan malah terbuka)

Ini penting supaya Claude selalu dapat JSON yang bisa diparse, tidak pernah dapat MCP tool error yang menghentikan flow.

---

## 12. Testing Plan (untuk coding agent)

1. Unit test `pdfMagicBytes.ts` — mock fetch, test PDF valid/invalid/timeout/no-range-support.
2. Unit test `rateLimiter.ts` — reserve/settle/release edge cases (concurrent calls, window reset).
3. Unit test `geminiKeyPool.ts` — mock 3 limiter dengan state rate-limited berbeda-beda, pastikan urutan coba key-1→2→3 benar, pastikan `msUntilAvailable` dihitung benar, pastikan `AllKeysRateLimitedError` dilempar tepat setelah `maxWaitMs` terlampaui (bukan sebelum/sesudahnya), dan pastikan loop retry setelah wait benar-benar mulai lagi dari key-1.
4. Integration test `analyze_journal_standard` dengan 1-2 PDF publik asli (misal arXiv) — pastikan JSON output valid schema.
5. Manual test `search_and_check_journals` end-to-end lewat client MCP (connect ke `http://localhost:PORT/mcp?key=...`), cek query nyata, verifikasi Claude tidak pernah menerima full text dokumen di response tool.
6. Manual test auth: panggil endpoint tanpa `?key=`, dengan key salah, dan dengan key benar — pastikan 401/500/sukses sesuai §11.
7. Manual test `/health` — curl tanpa `?key=`, pastikan 200 dan tidak butuh auth.
8. Manual test `/test` — curl dengan dan tanpa `?key=`, pastikan perilaku auth sama seperti `/mcp` (401 kalau salah/kosong, dummy JSON kalau benar).
9. Manual test `/favicon.ico` — curl tanpa `?key=`, pastikan 200 dengan `Content-Type: image/png` dan body gambar sesuai `MCP_ICON_URL`.
10. Simulasi manual: set `RATE_LIMIT_RPM` sangat rendah (misal 1) untuk trigger rate limit dengan cepat, kirim beberapa request berurutan, verifikasi log menunjukkan perpindahan key-1→2→3→wait→key-1 sesuai flow §6.2.

---

## 13. Status Keputusan Desain

### 13.1 Sudah Dikonfirmasi (tidak perlu diubah coding agent)

- `max_candidates` default **5** di `search_and_check_journals` — dikonfirmasi tetap.
- Rubrik prompt deterministik §5.1 (3-kriteria + contoh hukum Ohm) — dikonfirmasi dipakai apa adanya, tidak ada rubrik lama yang menggantikan.
- Flow `search_and_check_journals` (§7.7: `query → tavily → cek PDF (magic bytes) → Gemini judge → JSON pendek ke Claude`) — dikonfirmasi ini flow utama yang benar.
- `tavily_search` / `tavily_extract` / `tavily_crawl` (§7.1-7.3) **tetap dipertahankan sebagai tool granular terpisah**, return hasil mentah tanpa lewat Gemini — untuk kasus di luar verifikasi PDF (misal cari halaman index jurnal, referensi umum). `search_and_check_journals` tetap jadi tool utama untuk flow verifikasi PDF lengkap. **Catatan**: ini asumsi saya berdasarkan jawaban Anda yang menegaskan ulang flow §7.7 — kalau maksud Anda sebenarnya tool granular ini dihapus total dan semua pencarian wajib lewat pipeline verifikasi, beri tahu saya untuk direvisi.
- Rate limit RPM/TPM (15 / 250k per key), `GEMINI_KEY_MAX_WAIT_MS` (90 detik) — dikonfirmasi tetap.

### 13.2 Masih Asumsi Default (belum eksplisit dikonfirmasi)

- PDF text extraction pakai `pdf-parse` (bukan PyMuPDF karena ini project Node.js, bukan Python).
- Transport MCP: HTTP (Streamable HTTP), diakses lewat `http://host:PORT/mcp?key=MCP_API_KEY`, bukan stdio — supaya pemanggilan cukup lewat satu URL sesuai permintaan Anda.
- Auth server ini pakai query param `?key=`, sesuai yang Anda minta. Sudah saya tandai di §6.4 bahwa ini punya trade-off keamanan (rawan ke-log) dibanding header `Authorization` — kalau nanti mau upgrade ke header, tinggal ganti `authMiddleware.ts` saja tanpa ubah bagian lain.
- Rate limit RPM/TPM di §10 diasumsikan **sama** untuk ketiga API key (semua key dianggap tier yang sama). Kalau ketiga key Anda punya tier/kuota berbeda, `geminiKeyPool.ts` perlu terima config RPM/TPM per key, bukan satu config global — beri tahu coding agent kalau ini kasusnya.

---

## 14. Deployment ke Render

### 14.1 Tipe Service

Pakai **Web Service** (bukan Static Site / Background Worker / Cron Job) — karena ini server HTTP yang harus terus listen untuk menerima request `/mcp`, `/health`, `/test`, `/favicon.ico`.

### 14.2 Build & Start Command

```
Build Command: npm install && npm run build
Start Command: node dist/index.js
```

`package.json` perlu script berikut:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### 14.3 Port Binding — WAJIB

Render otomatis menginjeksikan env var `PORT` (biasanya `10000`) dan **mengharuskan** aplikasi listen di port itu, bukan port custom. Sudah disesuaikan di §6.4:

```ts
// config.ts
export const config = {
  port: Number(process.env.PORT ?? process.env.MCP_PORT ?? 3000),
  // ...config lain
};
```

Prioritas: `PORT` (dari Render) → `MCP_PORT` (kalau jalan manual/lokal) → fallback `3000`. Jangan hardcode `app.listen(3000)`.

### 14.4 Environment Variables

Render **tidak membaca file `.env`** dari repo saat deploy (beda dengan run lokal via `dotenv`). Semua env var di §10 harus di-input manual lewat Render Dashboard → Environment, atau lewat `render.yaml` (§14.7). Checklist yang wajib di-set di Render:

```
TAVILY_API_KEY
GEMINI_API_KEYS
GEMINI_MODEL
MAX_CHARS_PER_DOC
DEFAULT_MAX_CANDIDATES
RATE_LIMIT_RPM
RATE_LIMIT_TPM
GEMINI_KEY_MAX_WAIT_MS
MCP_API_KEY
MCP_ICON_URL
```

`PORT` **tidak perlu** di-set manual — Render yang mengisi otomatis.

### 14.5 Health Check Path

Di Render Dashboard → Settings → Health Check Path, isi `/health`. Endpoint ini sudah tidak butuh auth (§6.5), jadi Render bisa ping tanpa perlu tahu `MCP_API_KEY`. Ini penting supaya Render tahu kapan service dianggap "up" dan tidak salah restart service yang sebenarnya sehat.

### 14.6 Pertimbangan Free Tier — PENTING untuk key pool & rate limiter

Kalau pakai **Render Free plan**, web service akan **spin down otomatis** setelah ~15 menit tanpa traffic, dan cold start berikutnya bisa makan 30-50 detik sebelum service merespons lagi. Ini berinteraksi dengan dua bagian sistem:

- **`GEMINI_KEY_MAX_WAIT_MS`** (default 90 detik, §6.2): kalau ditambah cold start Render, total waktu tunggu sebelum Claude dapat respons bisa terasa lama di request pertama setelah idle. Bukan bug, tapi perlu diketahui — kalau mengganggu UX testing, pertimbangkan upgrade ke paid plan (tidak ada spin down) atau kecilkan `GEMINI_KEY_MAX_WAIT_MS`.
- **State in-memory** (`SlidingWindowLimiter`, `GeminiKeyPool`): state rate limiter tersimpan di memory proses Node. Setiap kali Render restart/spin-down-lalu-up service (baik karena idle, deploy baru, atau crash), **state ini ke-reset ke kosong**. Efeknya tidak berbahaya (limiter cuma "lupa" riwayat pemakaian, jadi menganggap kuota penuh lagi) — cuma perlu diketahui bahwa rate limiting ini **tidak persisten**, jadi kalau Render sering restart, proteksi rate limit sebenarnya jadi kurang ketat dari yang dikira. Untuk fase testing ini bukan masalah; kalau nanti perlu strict, next step wajar adalah pindah state limiter ke Redis (di luar scope spec ini).

### 14.7 (Opsional) `render.yaml` — Infra as Code

Supaya konfigurasi service tidak cuma di-setup manual lewat dashboard (dan gampang di-recreate), taruh file ini di root repo:

```yaml
services:
  - type: web
    name: journal-search-mcp
    env: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: node dist/index.js
    healthCheckPath: /health
    envVars:
      - key: TAVILY_API_KEY
        sync: false
      - key: GEMINI_API_KEYS
        sync: false
      - key: GEMINI_MODEL
        value: gemini-3.1-flash-lite
      - key: MAX_CHARS_PER_DOC
        value: "15000"
      - key: DEFAULT_MAX_CANDIDATES
        value: "5"
      - key: RATE_LIMIT_RPM
        value: "15"
      - key: RATE_LIMIT_TPM
        value: "250000"
      - key: GEMINI_KEY_MAX_WAIT_MS
        value: "90000"
      - key: MCP_API_KEY
        sync: false
      - key: MCP_ICON_URL
        value: https://oqmigmphfdwemlejkhyw.supabase.co/storage/v1/object/public/pageindex-books-test-A-001/Walter_White_S5B.png
```

`sync: false` dipakai untuk secret (API key) — artinya nilainya di-input manual lewat dashboard Render sekali, tidak ditulis/tersimpan di repo/`render.yaml`. Jangan pernah commit nilai API key asli ke `render.yaml` atau file apa pun di repo.

### 14.8 URL Final Setelah Deploy

Render akan kasih domain otomatis berbentuk `https://journal-search-mcp-xxxx.onrender.com` (HTTPS otomatis — ini sekaligus menutup catatan keamanan soal query param `?key=` di §6.4, karena traffic-nya sudah terenkripsi TLS end-to-end). URL final untuk dipanggil dari Claude jadi:

```
https://journal-search-mcp-xxxx.onrender.com/mcp?key=MCP_API_KEY_ANDA
```
