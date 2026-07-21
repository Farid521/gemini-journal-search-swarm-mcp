# journal-search-mcp

MCP Server (Node.js + TypeScript, Streamable HTTP transport) untuk pencarian dan
verifikasi jurnal akademik PDF. Dipanggil oleh Claude sebagai MCP client/orchestrator.
Claude tidak pernah membaca isi dokumen mentah — semua pembacaan/pemahaman konten
PDF didelegasikan ke sub-agent Gemini Flash Lite yang mengembalikan JSON pendek.

Lihat `specs.md` (dokumen asli) untuk spesifikasi lengkap. README ini hanya ringkasan
cara menjalankan.

## Instalasi

```bash
npm install
cp .env.example .env
# isi .env: TAVILY_API_KEY, GEMINI_API_KEYS, MCP_API_KEY minimal
```

## Menjalankan lokal

```bash
npm run build
npm start
# atau untuk development dengan watch mode:
npm run dev   # di terminal lain: node dist/index.js setiap kali rebuild
```

Server akan listen di `http://localhost:3000` (atau `MCP_PORT`/`PORT` kalau di-set).

Cek cepat:
```bash
curl http://localhost:3000/health
curl "http://localhost:3000/test?key=ISI_MCP_API_KEY_ANDA"
```

Endpoint MCP untuk dipasang di Claude:
```
http://localhost:3000/mcp?key=ISI_MCP_API_KEY_ANDA
```

## REST API (HTTP biasa)

Selain MCP, setiap tool juga bisa dipanggil lewat REST endpoint HTTP biasa —
berguna untuk integrasi dengan backend non-MCP, Postman, curl, atau agent yang
ingin akses JSON langsung tanpa protokol MCP.

### Autentikasi

Sama seperti MCP endpoint: API key dikirim lewat query string `?key=...`.

```
POST /api/verify-pdf?key=ISI_MCP_API_KEY_ANDA
```

Kalau key salah atau tidak ada → `401 { "error": "invalid_or_missing_api_key" }`.

### Daftar endpoint

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/tavily-search` | Pencarian web umum (Tavily Search) |
| POST | `/api/tavily-extract` | Ekstraksi konten halaman web |
| POST | `/api/tavily-crawl` | Crawl/jelajahi situs |
| POST | `/api/verify-pdf` | Verifikasi magic bytes PDF dari URL |
| POST | `/api/analyze-journal-standard` | Analisis jurnal standar (worker round-robin) |
| POST | `/api/analyze-journal-custom` | Analisis jurnal dengan prompt/field kustom |
| POST | `/api/search-and-check-journals` | Tool komposit: search → verify → judge |
| GET | `/api/tools` | Daftar semua tool yang tersedia (metadata) |

Semua endpoint POST menerima `Content-Type: application/json`. Input body
mengikuti schema yang sama dengan tool MCP — lihat `src/schemas/toolSchemas.ts`.

### Contoh request

```bash
# Verifikasi PDF
curl -X POST "http://localhost:3000/api/verify-pdf?key=ISI_MCP_API_KEY_ANDA" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/paper.pdf"}'
```

Response sukses (`200`):
```json
{
  "url": "https://example.com/paper.pdf",
  "is_pdf": true,
  "detected_signature": "%PDF-",
  "http_status": 200
}
```

Response validasi gagal (`400`):
```json
{
  "error": "invalid_input",
  "error_detail": "url: url harus valid"
}
```

Response tanpa/ salah API key (`401`):
```json
{
  "error": "invalid_or_missing_api_key"
}
```

### Discovery

```bash
curl "http://localhost:3000/api/tools?key=ISI_MCP_API_KEY_ANDA"
```

Mengembalikan daftar 7 tool dengan nama, method HTTP, dan path masing-masing.

## Tools yang tersedia

| Tool | Deskripsi |
|---|---|
| `tavily_search` | Pass-through pencarian web umum |
| `tavily_extract` | Pass-through ekstraksi konten halaman web |
| `tavily_crawl` | Pass-through crawl situs |
| `verify_pdf` | Cek magic bytes URL — benar PDF atau bukan |
| `analyze_journal_standard` | verify → extract → judge (worker gemini-1/2 round-robin) |
| `analyze_journal_custom` | Sama seperti standard, tapi worker gemini-3 + custom prompt opsional |
| `search_and_check_journals` | Tool komposit utama: search → verify → judge, banyak kandidat sekaligus |

## Error handling

Semua tool **tidak pernah throw** ke MCP client — setiap kegagalan (download gagal,
bukan PDF, semua API key rate limited, JSON tidak valid dari Gemini, dll) dibungkus
jadi field `error` / `error_detail` pada JSON output. Lihat kode error lengkap di
`src/types.ts` (`ToolErrorCode`) dan §11 `specs.md`.

Level HTTP (di luar tool JSON):
- `401 invalid_or_missing_api_key`
- `500 server_misconfigured_missing_mcp_api_key`
- `400 invalid_json_body`
- `404 not_found`

## Testing

```bash
npm run typecheck
```

Lihat §12 `specs.md` untuk testing plan lengkap (unit test rate limiter, key pool,
magic bytes checker, integration test dengan PDF publik, dll — belum di-generate
otomatis di sini, tulis sesuai kebutuhan Anda dengan test runner pilihan, mis. vitest).

## Deploy ke Render

Lihat `render.yaml` (infra-as-code) dan §14 `specs.md`. Ringkas:
- Type: **Web Service**
- Build: `npm install && npm run build`
- Start: `node dist/index.js`
- Health check path: `/health`
- `PORT` otomatis di-inject Render — jangan hardcode port lain.
- Set semua secret (`TAVILY_API_KEY`, `GEMINI_API_KEYS`, `MCP_API_KEY`) manual lewat
  Render Dashboard → Environment (jangan commit ke repo).

## Non-goals fase ini

- Worker 4 (Lightpanda/browser-rendering) — slot sudah disiapkan di `workerPool.ts`,
  tapi memanggilnya akan return error `not_implemented`.
- Caching hasil analisis.
- OCR untuk PDF hasil scan.
- Multi-user auth (hanya satu shared `MCP_API_KEY`).
