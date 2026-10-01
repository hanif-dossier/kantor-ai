// Memasang skema Kantor AI ke Supabase dan (sekali saja) membuat sandi pemilik + kunci pelapor.
// Sandi dan kunci ditulis ke D:\Ai Agent\rahasia\kantor-ai.txt, TIDAK PERNAH dicetak ke layar.
//   node pasang-db.mjs            pasang/perbarui skema; buat rahasia kalau belum ada
import fs from 'fs'; import crypto from 'crypto'; import { createRequire } from 'module';
const require = createRequire('D:/Ai Agent/absensi/alat/'); const pg = require('pg');
const FR = 'D:/Ai Agent/rahasia/kantor-ai.txt';
const pw = (fs.readFileSync('D:/Ai Agent/rahasia/supabase-markasku.txt', 'utf8').match(/^DB_PASSWORD=(.+)$/m) || [])[1].trim();
const db = new pg.Client({ host: 'aws-0-ap-south-1.pooler.supabase.com', port: 5432, user: 'postgres.hzxfheydtrjhizbwbddh', password: pw, database: 'postgres', ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query(fs.readFileSync(new URL('../supabase/skema.sql', import.meta.url), 'utf8')); console.log('skema terpasang');
  const { rows } = await db.query('select 1 from kantor_pemilik where id = 1');
  if (rows.length) { console.log('akun pemilik sudah ada, tidak diubah'); }
  else {
    const KATA = ['kantor', 'meja', 'lampu', 'kopi', 'pagi', 'rapat', 'kertas', 'jendela', 'tangga', 'pintu', 'peta', 'jam', 'buku', 'tinta', 'lemari', 'kursi'];
    const sandi = Array.from({ length: 4 }, () => KATA[crypto.randomInt(0, KATA.length)]).join('-') + '-' + crypto.randomInt(10, 100);
    const kunci = crypto.randomBytes(24).toString('hex');
    await db.query("insert into kantor_pemilik(id, sandi_hash, rahasia_hash) values (1, extensions.crypt($1, extensions.gen_salt('bf', 10)), encode(extensions.digest($2, 'sha256'), 'hex'))", [sandi, kunci]);
    fs.writeFileSync(FR, `# Kantor AI (kantor.markasku.my.id). Dibuat ${new Date().toISOString()}\nSANDI_PEMILIK=${sandi}\nKANTOR_KUNCI=${kunci}\n`, { flag: 'a' });
    console.log('akun pemilik dan kunci pelapor dibuat, ditulis ke', FR); }
  const r = fs.existsSync(FR) ? fs.readFileSync(FR, 'utf8') : ''; console.log('rahasia:', FR, '| panjang sandi', (r.match(/^SANDI_PEMILIK=(.+)$/m) || ['', ''])[1].length, '| panjang kunci', (r.match(/^KANTOR_KUNCI=(.+)$/m) || ['', ''])[1].length);
} finally { await db.end(); }
