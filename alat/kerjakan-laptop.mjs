// Pekerja laptop Kantor AI (6 Okt 2026). Mengerjakan tugas 'laptop' yang dimasukkan Manajer (Pak Hadi) dari perintah
// pemilik di Ruang Manajer atau kolom chat karyawan: pekerjaan yang hanya bisa di laptop (Excel, aplikasi OFU/NTA,
// berkas lokal, Markasku, situs). Tiap tugas dijalankan Claude Code tanpa layar di D:\Ai Agent (CLAUDE.md dan memori
// ikut berlaku), lalu ringkasan hasilnya dibalas ke chat yang meminta, atas nama karyawan yang ditunjuk.
//
// Dipicu tiap 10 menit oleh jalankan-perintah.mjs (n8n -> perbarui-otomatis.mjs), atau tangan:
//   node kantor-ai/alat/kerjakan-laptop.mjs
// Satu pekerja saja pada satu waktu (kunci di folder temp). Kunci rahasia dibaca dari rahasia/kantor-ai.txt.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { lapor } from './lapor.mjs';
const SB = 'https://hzxfheydtrjhizbwbddh.supabase.co', ANON = 'sb_publishable_3c_5VhfP4Z9g1dSU9c00HQ_0QkuiHTm';
const KUNCI = process.env.KANTOR_KUNCI || (() => { try { return (fs.readFileSync('D:/Ai Agent/rahasia/kantor-ai.txt', 'utf8').match(/^KANTOR_KUNCI=(\S+)$/m) || [])[1] || ''; } catch { return ''; } })();
const CLAUDE = path.join(process.env.APPDATA || '', 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
const KUNCI_BERKAS = path.join(os.tmpdir(), 'kantor-pekerja-laptop.lock'), BATAS_MENIT = 30;
const NAMA = { 'juru-catat-ofu': 'Umar, juru catat OFU (usaha minyak)', 'juru-invoice-nta': 'Lina, juru invoice NTA', 'mentor-ofu': 'Pak Wira, mentor juru catat OFU', 'claude-code': 'Tim Studio',
  peneliti: 'Agus, peneliti (mengumpulkan fakta bersumber dari web dan berkas)', analis: 'Maya, analis (mengubah fakta jadi temuan)', penulis: 'Reza, penulis (menyusun tulisan jadi)', pemeriksa: 'Nina, pemeriksa (mencocokkan tulisan dengan sumbernya)' };
const rpc = async (fn, body) => { const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); return r.json().catch(() => ({ ok: false })); };

// Alat yang boleh dipakai tanpa ditanya; penghapusan dan push paksa ditolak. Sisanya ditolak otomatis (mode -p tidak bisa bertanya).
const BOLEH = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit', 'WebSearch', 'WebFetch',
  'Bash(node:*)', 'Bash(python:*)', 'Bash(py:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git pull:*)', 'Bash(git push:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(find:*)', 'Bash(mkdir:*)', 'Bash(cp:*)', 'Bash(wc:*)', 'Bash(sort:*)', 'Bash(npm:*)', 'Bash(npx:*)'];
const TOLAK = ['Bash(rm:*)', 'Bash(del:*)', 'Bash(rmdir:*)', 'Bash(mv:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(git reset --hard:*)', 'Bash(git clean:*)', 'Bash(git checkout --:*)'];

function aturan(t) { const siapa = NAMA[t.atas_nama] || 'karyawan Kantor AI';
  return `Kamu ${siapa}, bekerja di laptop pemilik (Hanif) di folder D:\\Ai Agent. Perintah ini datang dari pemilik lewat Kantor AI dan diteruskan Manajer (Pak Hadi). Pemilik tidak sedang menonton dan tidak bisa ditanya; kerjakan sampai selesai dengan keputusan wajar, atau berhenti dan jelaskan kalau butuh keputusan pemilik.

Aturan keras:
- Pakai otak dulu (node "D:/Ai Agent/otak/cari.mjs" <kata kunci>) dan ikuti CLAUDE.md serta memori.
- Jangan menghapus atau menimpa berkas pemilik, terutama Excel di D:\\MBG dan Documents\\MINYAK ANDRE; Excel hanya dibaca.
- Jangan memposting, mempublikasikan, mengirim pesan, membayar, atau mengubah akun dan kata sandi apa pun.
- Jangan menampilkan nilai kunci atau kata sandi dari folder rahasia.
- Kalau mengubah kode aplikasi, uji dulu; komit dengan -c user.name="hanif-dossier" -c user.email="abdullahhanif033@gmail.com" tanpa baris Co-Authored-By.
- Tulis catatan sesi singkat di catatan/ kalau ada yang diubah.

Pesan terakhirmu langsung dikirim ke chat pemilik di Kantor AI: Bahasa Indonesia, paling banyak 5 kalimat, sebutkan apa yang sudah dikerjakan dan hasilnya (angka, nama berkas), tanpa tanda pisah panjang, tanpa emoji, tanpa format tebal.

Perintah:
${t.perintah}`; }

async function kerjakan(t) {
  const agen = t.atas_nama || 'claude-code', jalanId = 'laptop-' + t.id, tugas = String(t.perintah).replace(/\s+/g, ' ').slice(0, 90);
  await lapor(agen, 'kerja', { tugas, sumber: 'laptop', jalanId });
  // Lingkungan bersih: variabel sesi aplikasi desktop (CLAUDE_*, ANTHROPIC_*) membuat Claude Code baris perintah gagal masuk.
  // Kalau pemilik memasang token jangka panjang (claude setup-token) di rahasia/kantor-ai.txt sebagai CLAUDE_TOKEN, itu yang dipakai.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k)));
  const tok = (() => { try { return (fs.readFileSync('D:/Ai Agent/rahasia/kantor-ai.txt', 'utf8').match(/^CLAUDE_TOKEN=(\S+)$/m) || [])[1]; } catch { return null; } })(); if (tok) env.CLAUDE_CODE_OAUTH_TOKEN = tok;
  const r = spawnSync(CLAUDE, ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', '80', '--allowedTools', ...BOLEH, '--disallowedTools', ...TOLAK],
    { cwd: 'D:/Ai Agent', env, input: aturan(t), encoding: 'utf8', timeout: BATAS_MENIT * 60000, maxBuffer: 1 << 26, windowsHide: true });
  let j = {}; try { j = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch {}
  const gagal = r.error || r.status !== 0 || j.is_error, teks = String(j.result || '').trim();
  const balasan = gagal ? `Tugas laptop belum berhasil: ${r.error?.code === 'ETIMEDOUT' ? `lewat ${BATAS_MENIT} menit` : (teks || r.stderr || 'Claude Code tidak menjawab').slice(0, 300)}.` : teks.slice(0, 1800);
  const token = (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0) + (j.usage?.cache_read_input_tokens || 0);
  await rpc('kantor_chat_balas', { p_rahasia: KUNCI, p_dari: t.atas_nama || 'manajer', p_isi: balasan, p_ref: t.ref ?? null, p_tindakan: null, p_status_ref: 'selesai' });
  await lapor(agen, gagal ? 'gagal' : 'selesai', { tugas, hasil: balasan.slice(0, 200), sumber: 'laptop', jalanId, token, biaya: 0 });
  return { id: t.id, berhasil: !gagal, detik: Math.round((j.duration_ms || 0) / 1000) };
}

export async function kerjakanLaptop() {
  if (!KUNCI || !fs.existsSync(CLAUDE)) return { lewat: !KUNCI ? 'kunci tidak ada' : 'Claude Code tidak ditemukan' };
  try { const st = fs.statSync(KUNCI_BERKAS); if (Date.now() - st.mtimeMs < (BATAS_MENIT + 10) * 60000) return { lewat: 'pekerja lain masih jalan' }; } catch {}
  fs.writeFileSync(KUNCI_BERKAS, String(process.pid)); const hasil = [];
  try { for (let putaran = 0; putaran < 3; putaran++) { const a = await rpc('kantor_laptop_ambil', { p_rahasia: KUNCI }); if (!a.ok || !a.tugas?.length) break;
      for (const t of a.tugas) hasil.push(await kerjakan(t).catch(e => ({ id: t.id, berhasil: false, galat: e.message }))); } }
  finally { try { fs.unlinkSync(KUNCI_BERKAS); } catch {} }
  return { dikerjakan: hasil };
}
if (process.argv[1] && /kerjakan-laptop\.mjs$/.test(process.argv[1])) console.log(JSON.stringify(await kerjakanLaptop()));
