// Uji sungguhan kolom chat karyawan (5 Okt 2026): menulis satu pesan pemilik bertanda agen langsung di database lalu
// mengetuk jembatan GitHub, sama persis dengan kantor_chat_kirim tetapi tanpa sesi HP. Membaca balasan dengan --baca.
//   node kantor-ai/alat/uji-chat-agen.mjs radar "pesan"     kirim
//   node kantor-ai/alat/uji-chat-agen.mjs --baca            lihat 8 pesan terakhir
import fs from 'node:fs'; import { createRequire } from 'node:module';
const pg = createRequire('D:/Ai Agent/absensi/alat/kerja/x.js')('pg');
const pw = (fs.readFileSync('D:/Ai Agent/rahasia/supabase-markasku.txt', 'utf8').match(/^DB_PASSWORD=(.+)$/m) || [])[1].trim();
const db = new pg.Client({ host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, user: 'postgres.hzxfheydtrjhizbwbddh', password: pw, database: 'postgres', ssl: { rejectUnauthorized: false } });
await db.connect();
if (process.argv[2] === '--baca') {
  const r = await db.query("select id, dari, agen, status, ref, left(isi, 400) isi, to_char(dibuat at time zone 'Asia/Jakarta', 'HH24:MI:SS') jam from kantor_chat order by id desc limit 8");
  for (const x of r.rows.reverse()) console.log(`#${x.id} ${x.jam} ${x.dari}${x.agen ? ' [' + x.agen + ']' : ''} ${x.status}${x.ref ? ' ref ' + x.ref : ''}\n   ${x.isi}`);
} else {
  let [agen, isi] = process.argv.slice(2); if (!agen || !isi) throw new Error('pakai: <agen|manajer> "<pesan>"'); if (agen === 'manajer') agen = null;   // manajer = Ruang Manajer (tanpa agen)
  const r = await db.query("insert into kantor_chat(dari, isi, status, agen) values ('pemilik', $1, 'baru', $2) returning id, dibuat", [isi, agen]);
  const n = await db.query('select public.kantor__ke_github($1, $2, $3, $4) as net', [r.rows[0].id, isi, r.rows[0].dibuat, agen]);
  console.log('pesan #' + r.rows[0].id, 'untuk', agen, '· ketukan GitHub', n.rows[0].net ? 'terkirim' : 'GAGAL (token kosong)');
}
await db.end();
