// Memasang Rina balas komentar dan DM Instagram ke database markasku (kantor-ai/supabase/ig-balas.sql) dan melihat
// keadaannya. Pesan sebelum pemasangan pertama tidak dibalas (ig_atur.mulai = saat dipasang).
//   node kantor-ai/alat/pasang-ig-balas.mjs            pasang atau perbarui skema + jadwal pg_cron 2 menit
//   node kantor-ai/alat/pasang-ig-balas.mjs --lihat    keadaan: aktif, terakhir jalan, isi kotak masuk (tanpa isi pesan)
//   node kantor-ai/alat/pasang-ig-balas.mjs --mati     matikan balasan otomatis (--nyala untuk menyalakan)
import fs from 'node:fs'; import { createRequire } from 'node:module';
const pg = createRequire('D:/Ai Agent/absensi/alat/kerja/x.js')('pg');
const pw = (fs.readFileSync('D:/Ai Agent/rahasia/supabase-markasku.txt', 'utf8').match(/^DB_PASSWORD=(.+)$/m) || [])[1].trim();
const db = new pg.Client({ host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, user: 'postgres.hzxfheydtrjhizbwbddh', password: pw, database: 'postgres', ssl: { rejectUnauthorized: false } });
await db.connect(); const a = process.argv[2];
if (a === '--mati' || a === '--nyala') await db.query('update ig_atur set aktif = $1, mulai = case when $1 and not aktif then now() else mulai end where id = 1', [a === '--nyala']);
else if (a !== '--lihat') { await db.query(fs.readFileSync('D:/Ai Agent/kantor-ai/supabase/ig-balas.sql', 'utf8')); console.log('skema ig-balas terpasang'); }
const s = (await db.query("select aktif, to_char(mulai at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') mulai, to_char(terakhir at time zone 'Asia/Jakarta', 'DD Mon HH24:MI:SS') terakhir from ig_atur")).rows[0];
const k = (await db.query("select jenis, status, count(*)::int n from ig_masuk group by 1, 2 order by 1, 2")).rows;
const j = (await db.query("select jobname, schedule, active from cron.job where jobname = 'rina-ig-balas'")).rows;
const h = (await db.query("select status, return_message, to_char(start_time at time zone 'Asia/Jakarta', 'HH24:MI:SS') jam from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'rina-ig-balas') order by start_time desc limit 3")).rows;
console.log('aktif', s.aktif, '· balas pesan sejak', s.mulai, '· terakhir periksa', s.terakhir || '-');
console.log('jadwal', JSON.stringify(j), '\njalan terakhir', JSON.stringify(h), '\nkotak masuk', JSON.stringify(k));
await db.end();
