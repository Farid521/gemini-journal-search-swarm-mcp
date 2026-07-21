#!/usr/bin/env bash
set -euo pipefail

# Test skrip untuk REST endpoints — dijalankan setelah server start.
# PS: jalankan "npx tsx src/index.ts" dulu di terminal lain, lalu jalankan skrip ini.

BASE="${1:-http://localhost:3000}"
API_KEY="${2:-you-are-goddamn-right-im-the-man-who-kill-gus-fring-im-heisenberg}"
pass=0
fail=0

green() { printf "\e[32m%s\e[0m\n" "$1"; }
red()   { printf "\e[31m%s\e[0m\n" "$1"; }

check() {
  local desc="$1" exp_http="$2" body_file="$3"
  local actual=$(head -1 "$body_file" | tr -d '\r\n')
  if echo "$actual" | grep -q "$exp_http"; then
    green "  PASS: $desc"
    pass=$((pass+1))
  else
    red "  FAIL: $desc — expected HTTP $exp_http, got: $actual"
    fail=$((fail+1))
  fi
}

check_json() {
  local desc="$1" body_file="$2" field="$3" exp_val="$4"
  local actual=$(head -4 "$body_file" | grep -oP '"'"$field"'":\s*("[^"]*"|[0-9a-zA-Z_]+)' | head -1)
  if echo "$actual" | grep -q "$exp_val"; then
    green "  PASS: $desc (${field}=${exp_val})"
    pass=$((pass+1))
  else
    red "  FAIL: $desc — expected ${field}=${exp_val}, got: $actual"
    fail=$((fail+1))
  fi
}

tmpdir=$(mktemp -d)
trap "rm -rf $tmpdir" EXIT

echo "=========================================="
echo " REST API Test Suite — $BASE"
echo "=========================================="
echo ""

# ---- 1. HEALTH (tanpa auth) ----
echo "[1] GET /health (tanpa auth)"
curl -s -o "$tmpdir/health.txt" -w "%{http_code}" "$BASE/health" > "$tmpdir/health_http.txt" 2>&1
check "tanpa auth, harus 200" "200" "$tmpdir/health_http.txt"
grep -q '"status":"ok"' "$tmpdir/health.txt" && { green "  PASS: /health body contains status=ok"; pass=$((pass+1)); } || { red "  FAIL: /health body wrong"; fail=$((fail+1)); }

# ---- 2. NO AUTH (tanpa ?key=...) ----
echo "[2] POST /api/verify-pdf (tanpa auth)"
curl -s -o "$tmpdir/noauth.txt" -w "%{http_code}" \
  -X POST "$BASE/api/verify-pdf" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/test.pdf"}' > "$tmpdir/noauth_http.txt" 2>&1
check "tanpa auth, harus 401" "401" "$tmpdir/noauth_http.txt"
grep -q '"invalid_or_missing_api_key"' "$tmpdir/noauth.txt" && { green "  PASS: response body invalid_or_missing_api_key"; pass=$((pass+1)); } || { red "  FAIL: body mismatch"; fail=$((fail+1)); }

# ---- 3. WRONG AUTH ----
echo "[3] POST /api/verify-pdf (salah key)"
curl -s -o "$tmpdir/wrongauth.txt" -w "%{http_code}" \
  -X POST "$BASE/api/verify-pdf?key=salah-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/test.pdf"}' > "$tmpdir/wrongauth_http.txt" 2>&1
check "salah key, harus 401" "401" "$tmpdir/wrongauth_http.txt"

# ---- 4. INVALID BODY ----
echo "[4] POST /api/verify-pdf (body tidak valid — empty json)"
curl -s -o "$tmpdir/invalid.txt" -w "%{http_code}" \
  -X POST "$BASE/api/verify-pdf?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' > "$tmpdir/invalid_http.txt" 2>&1
check "body kosong, harus 400" "400" "$tmpdir/invalid_http.txt"
grep -q '"invalid_input"' "$tmpdir/invalid.txt" && { green "  PASS: invalid_input"; pass=$((pass+1)); } || { red "  FAIL: body mismatch"; fail=$((fail+1)); }

# ---- 5. VERIFY PDF — URL BUKAN PDF ----
echo "[5] POST /api/verify-pdf (URL bukan PDF)"
curl -s -o "$tmpdir/notpdf.txt" -w "%{http_code}" \
  -X POST "$BASE/api/verify-pdf?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' > "$tmpdir/notpdf_http.txt" 2>&1
check "URL bukan PDF, harus 200" "200" "$tmpdir/notpdf_http.txt"
grep -q '"is_pdf":false' "$tmpdir/notpdf.txt" && { green "  PASS: is_pdf=false"; pass=$((pass+1)); } || { red "  FAIL: is_pdf not false"; fail=$((fail+1)); }

# ---- 6. TAVILY SEARCH ----
echo "[6] POST /api/tavily-search (query valid)"
curl -s -o "$tmpdir/search.txt" -w "%{http_code}" \
  -X POST "$BASE/api/tavily-search?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"machine learning 2024","max_results":3}' > "$tmpdir/search_http.txt" 2>&1
check "tavily-search valid, harus 200" "200" "$tmpdir/search_http.txt"
grep -q '"results"' "$tmpdir/search.txt" && { green "  PASS: response has results array"; pass=$((pass+1)); } || { red "  FAIL: no results field"; fail=$((fail+1)); }

# ---- 7. TAVILY SEARCH — query kosong ----
echo "[7] POST /api/tavily-search (query kosong)"
curl -s -o "$tmpdir/search_empty.txt" -w "%{http_code}" \
  -X POST "$BASE/api/tavily-search?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":""}' > "$tmpdir/search_empty_http.txt" 2>&1
check "tavily-search query kosong, harus 400" "400" "$tmpdir/search_empty_http.txt"

# ---- 8. TAVILY EXTRACT ----
echo "[8] POST /api/tavily-extract (URL valid)"
curl -s -o "$tmpdir/extract.txt" -w "%{http_code}" \
  -X POST "$BASE/api/tavily-extract?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://example.com"]}' > "$tmpdir/extract_http.txt" 2>&1
check "tavily-extract valid, harus 200" "200" "$tmpdir/extract_http.txt"

# ---- 9. TAVILY CRAWL ----
echo "[9] POST /api/tavily-crawl (URL valid)"
curl -s -o "$tmpdir/crawl.txt" -w "%{http_code}" \
  -X POST "$BASE/api/tavily-crawl?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","max_depth":1,"limit":5}' > "$tmpdir/crawl_http.txt" 2>&1
check "tavily-crawl valid, harus 200" "200" "$tmpdir/crawl_http.txt"

# ---- 10. ANALYZE JOURNAL STANDARD ----
echo "[10] POST /api/analyze-journal-standard (URL valid PDF)"
curl -s -o "$tmpdir/analyze_std.txt" -w "%{http_code}" \
  -X POST "$BASE/api/analyze-journal-standard?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://arxiv.org/pdf/1706.03762.pdf","query":"attention is all you need"}' > "$tmpdir/analyze_std_http.txt" 2>&1
check "analyze-journal-standard, harus 200" "200" "$tmpdir/analyze_std_http.txt"

# ---- 11. ANALYZE JOURNAL CUSTOM ----
echo "[11] POST /api/analyze-journal-custom (URL valid PDF)"
curl -s -o "$tmpdir/analyze_cust.txt" -w "%{http_code}" \
  -X POST "$BASE/api/analyze-journal-custom?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://arxiv.org/pdf/1706.03762.pdf","query":"transformer","custom_instruction":"Beri highlight pada novelty","max_chars":5000}' > "$tmpdir/analyze_cust_http.txt" 2>&1
check "analyze-journal-custom, harus 200" "200" "$tmpdir/analyze_cust_http.txt"

# ---- 12. SEARCH AND CHECK JOURNALS ----
echo "[12] POST /api/search-and-check-journals (query valid)"
curl -s -o "$tmpdir/search_check.txt" -w "%{http_code}" \
  -X POST "$BASE/api/search-and-check-journals?key=$API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"transformer attention","max_candidates":2}' > "$tmpdir/search_check_http.txt" 2>&1
check "search-and-check-journals, harus 200" "200" "$tmpdir/search_check_http.txt"

# ---- 13. DISCOVERY ENDPOINT ----
echo "[13] GET /api/tools"
curl -s -o "$tmpdir/tools.txt" -w "%{http_code}" \
  -X GET "$BASE/api/tools?key=$API_KEY" > "$tmpdir/tools_http.txt" 2>&1
check "GET /api/tools, harus 200" "200" "$tmpdir/tools_http.txt"
grep -q '"tools"' "$tmpdir/tools.txt" && { green "  PASS: response has tools array"; pass=$((pass+1)); } || { red "  FAIL: no tools field"; fail=$((fail+1)); }
TOOL_COUNT=$(grep -o '"name":' "$tmpdir/tools.txt" | wc -l)
[ "$TOOL_COUNT" = "7" ] && { green "  PASS: 7 tools listed (count=$TOOL_COUNT)"; pass=$((pass+1)); } || { red "  FAIL: expected 7 tools, got $TOOL_COUNT"; fail=$((fail+1)); }

# ---- 14. MCP ENDPOINT MASIH BERFUNGSI ----
echo "[14] GET /test (MCP endpoint masih berfungsi)"
curl -s -o "$tmpdir/test_mcp.txt" -w "%{http_code}" \
  -X GET "$BASE/test?key=$API_KEY" > "$tmpdir/test_mcp_http.txt" 2>&1
check "GET /test, harus 200" "200" "$tmpdir/test_mcp_http.txt"
grep -q '"status":"ok"' "$tmpdir/test_mcp.txt" && { green "  PASS: /test masih hidup"; pass=$((pass+1)); } || { red "  FAIL: /test bermasalah"; fail=$((fail+1)); }

# ---- 15. 404 UNKNOWN PATH ----
echo "[15] GET /api/nonexistent"
curl -s -o "$tmpdir/unknown.txt" -w "%{http_code}" \
  -X GET "$BASE/api/nonexistent?key=$API_KEY" > "$tmpdir/unknown_http.txt" 2>&1
check "path tidak dikenal, harus 404" "404" "$tmpdir/unknown_http.txt"

# ---- SUMMARY ----
echo ""
echo "=========================================="
echo " SUMMARY"
echo "=========================================="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "=========================================="
[ "$fail" -eq 0 ] && exit 0 || exit 1
