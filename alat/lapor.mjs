// Pelapor Kantor AI untuk skrip Node di laptop (n8n) dan GitHub Actions.
//   import { lapor } from '.../kantor-ai/alat/lapor.mjs'
//   await lapor('juru-catat-minyak', 'kerja', { tugas: 'Baca Excel minggu 21', sumber: 'n8n', jalanId })
//   await lapor('juru-catat-minyak', 'selesai', { tugas: ..., hasil: 'Laporan harian diperbarui', tautan, token, biaya })
// Kunci dibaca dari env KANTOR_KUNCI (GitHub secret) atau berkas rahasia di laptop. Tidak pernah melempar galat:
// pekerjaan utama tidak boleh gagal hanya karena papan status tidak terjangkau. Mengembalikan daftar perintah yang
// menunggu untuk agen itu (mis. [{ perintah: 'jalan' }]) atau [].
import fs from 'fs';
const URL_ = 'https://hzxfheydtrjhizbwbddh.supabase.co/rest/v1/rpc/kantor_lapor';
const ANON = 'sb_publishable_3c_5VhfP4Z9g1dSU9c00HQ_0QkuiHTm';
function kunci() { if (process.env.KANTOR_KUNCI) return process.env.KANTOR_KUNCI;
  try { return (fs.readFileSync('D:/Ai Agent/rahasia/kantor-ai.txt', 'utf8').match(/^KANTOR_KUNCI=(\S+)$/m) || [])[1] || ''; } catch { return ''; } }
export async function lapor(agen, status, { tugas = null, hasil = null, tautan = null, sumber = null, jalanId = null, token = null, biaya = null } = {}) {
  try {
    const r = await fetch(URL_, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ p_rahasia: kunci(), p_agen: agen, p_status: status, p_tugas: tugas, p_hasil: hasil, p_tautan: tautan, p_sumber: sumber, p_jalan_id: jalanId, p_token: token, p_biaya: biaya }) });
    const j = await r.json().catch(() => ({})); return j.ok ? (j.perintah || []) : [];
  } catch { return []; } }
// Dipanggil dari baris perintah (GitHub Actions): node lapor.mjs <agen> <status> "<tugas>" ["<hasil>"] ["<tautan>"]
if (process.argv[1] && /lapor\.mjs$/.test(process.argv[1]) && process.argv.length > 3) {
  const [, , agen, status, tugas, hasil, tautan] = process.argv;
  const p = await lapor(agen, status, { tugas, hasil, tautan, sumber: process.env.GITHUB_ACTIONS ? 'github' : 'laptop', jalanId: process.env.GITHUB_RUN_ID || null });
  console.log(JSON.stringify({ dilaporkan: agen, status, perintah: p })); }
