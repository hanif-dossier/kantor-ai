// Menjalankan perintah "Suruh kerja sekarang" dari Kantor AI untuk karyawan yang hidup di GitHub Actions.
// Dipanggil dari laptop (ujung perbarui-otomatis.mjs, n8n tiap 10 menit): ambil antrean lewat kantor_antrean, lalu
// picu workflow_dispatch di repo yang sesuai dengan token GitHub dari rahasia/kantor-ai.txt (GITHUB_TOKEN, dari
// `gh auth token`, cakupan 'workflow'). Karyawan laptop (juru-catat-ofu, juru-invoice-nta) sudah membaca antreannya
// sendiri lewat lapor(), jadi tidak ada di peta ini. Tidak pernah melempar galat.
import fs from 'fs';
const URL_ = 'https://hzxfheydtrjhizbwbddh.supabase.co/rest/v1/rpc/kantor_antrean';
const ANON = 'sb_publishable_3c_5VhfP4Z9g1dSU9c00HQ_0QkuiHTm';
const PETA = {
  bahan: ['hanif-dossier/laporan-harian', 'bahan.yml'],
  briefing: ['hanif-dossier/laporan-harian', 'laporan-harian.yml'],
  radar: ['hanif-dossier/laporan-harian', 'radar-peringatan.yml'],
  pasar: ['hanif-dossier/hanif-dossier.github.io', 'data-pasar.yml'],
  kabar: ['hanif-dossier/laporan-harian', 'kabar-blog.yml'],
  kurir: ['hanif-dossier/laporan-harian', 'unggah.yml'],
};
const baca = k => { try { return (fs.readFileSync('D:/Ai Agent/rahasia/kantor-ai.txt', 'utf8').match(new RegExp('^' + k + '=(\\S+)$', 'm')) || [])[1] || ''; } catch { return ''; } };
export async function jalankanPerintah() {
  const hasil = []; try {
    const r = await fetch(URL_, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ p_rahasia: baca('KANTOR_KUNCI'), p_agen: Object.keys(PETA) }) });
    const j = await r.json().catch(() => ({})); if (!j.ok) return hasil;
    const token = baca('GITHUB_TOKEN'); if (!token) return hasil;
    for (const p of j.perintah || []) { const [repo, wf] = PETA[p.agen] || []; if (!repo) continue;
      const d = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ ref: 'main' }) });
      hasil.push({ agen: p.agen, dipicu: d.status === 204, status: d.status }); }
  } catch {} return hasil; }
if (process.argv[1] && /jalankan-perintah\.mjs$/.test(process.argv[1])) console.log(JSON.stringify(await jalankanPerintah()));
