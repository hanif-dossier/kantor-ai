// Memasang supabase/konten.sql (status draf dan rahasia Instagram untuk Rina) ke project markasku, dan/atau
// mengunggah token Instagram dari rahasia/instagram.txt (IG_TOKEN=...) ke tabel cs_rahasia. Nilai tidak pernah dicetak.
//   node kantor-ai/alat/pasang-konten-db.mjs            -> skema saja
//   node kantor-ai/alat/pasang-konten-db.mjs --token    -> skema + token Instagram dari rahasia/instagram.txt
import fs from 'fs'; import { createRequire } from 'module';
const pg = createRequire('D:/Ai Agent/absensi/alat/kerja/x.js')('pg');
const pw = (fs.readFileSync('D:/Ai Agent/rahasia/supabase-markasku.txt', 'utf8').match(/^DB_PASSWORD=(.+)$/m) || [])[1].trim();
const db = new pg.Client({ host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, user: 'postgres.hzxfheydtrjhizbwbddh', password: pw, database: 'postgres', ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query(fs.readFileSync('D:/Ai Agent/kantor-ai/supabase/konten.sql', 'utf8')); console.log('skema konten terpasang');
  await db.query(fs.readFileSync('D:/Ai Agent/kantor-ai/supabase/chat.sql', 'utf8')); console.log('skema chat terpasang');
  if (process.argv.includes('--github')) {   // token GitHub (rahasia/kantor-ai.txt) untuk jembatan Ruang Manajer -> repo laporan-harian
    const g = (fs.readFileSync('D:/Ai Agent/rahasia/kantor-ai.txt', 'utf8').match(/^GITHUB_TOKEN=(\S+)$/m) || [])[1]; if (!g) throw new Error('GITHUB_TOKEN tidak ada');
    await db.query("insert into cs_rahasia(nama, nilai) values ('github_token', $1) on conflict (nama) do update set nilai = excluded.nilai, diubah = now()", [g]); console.log(`token GitHub dipasang (${g.length} huruf)`); }
  if (process.argv.includes('--token')) {
    const t = (fs.readFileSync('D:/Ai Agent/rahasia/instagram.txt', 'utf8').match(/^IG_TOKEN=(.+)$/m) || [])[1]?.trim();
    if (!t || t.length < 20) throw new Error('IG_TOKEN kosong di rahasia/instagram.txt');
    await db.query("insert into cs_rahasia(nama, nilai) values ('ig_token', $1) on conflict (nama) do update set nilai = excluded.nilai, diubah = now()", [t]);
    console.log(`token Instagram dipasang (${t.length} huruf)`);
  }
  console.log((await db.query("select nama, length(nilai) as panjang, diubah from cs_rahasia order by nama")).rows.map(r => `${r.nama}: ${r.panjang} huruf, ${r.diubah.toISOString().slice(0, 16)}`).join('\n'));
} finally { await db.end(); }
