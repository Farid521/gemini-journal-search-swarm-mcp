/**
 * Prompt deterministik untuk worker 1 & 2 (dan default worker 3 kalau tidak
 * ada custom_instruction). Rubrik ini adalah starting point/asumsi (§5.1,
 * catatan untuk coding agent) — kalau Anda sudah punya rubrik 4-kriteria
 * "basic level academic content judgment" dari sistem sebelumnya, ganti isi
 * template di bawah ini (termasuk contoh few-shot-nya) dengan versi asli Anda.
 */
export function buildDeterministicInstruction(maxChars: number): string {
  return `Anda menerima:
- QUERY: topik yang dicari user
- DOCUMENT_TEXT: potongan teks dokumen (maks ${maxChars} karakter)

Tugas: tentukan apakah dokumen ini relevan dengan QUERY dan memuat MINIMAL:
1. has_basic_explanation: penjelasan konsep dasar terkait QUERY (bukan cuma abstrak/referensi)
2. has_basic_equations: persamaan/rumus dasar yang relevan dengan QUERY (jika topik memang bersifat kuantitatif; jika topik non-matematis, field ini boleh true jika ada definisi formal/notasi setara)
3. is_relevant: dokumen memang membahas QUERY, bukan cuma menyebut sekilas dan yang paling penting adalah dokumen
  benar benar merupakan sebuha artikel jurnal, yang berarti harus memiliki abstract, nama penulis dan atribut yang umumnya ada di
  artikel jurnal. Jika dokumen tidak memiliki kriteria sebuah artikel jurnal maka buat is_relevant: False karena anda akan
  menemui banyak sekali dokumen-dokumen berupa buku, instruksi lab, atau dokumen irelevan lainya.

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
}`;
}

/** Instruksi tambahan dipakai saat retry setelah Gemini balas non-JSON (§11). */
export function buildStrictJsonRetryInstruction(originalPrompt: string): string {
  return `${originalPrompt}

PENTING: Jawaban sebelumnya tidak valid JSON. Kali ini WAJIB jawab HANYA dengan
satu objek JSON valid, tanpa markdown code fence (tanpa \`\`\`), tanpa teks
pembuka/penutup apa pun. Mulai langsung dengan karakter "{" dan akhiri dengan "}".`;
}
