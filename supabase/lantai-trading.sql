-- =====================================================================================================
-- LANTAI TRADING (13 Okt 2026). Pemilik: "saya mau ai agent yang khusus untuk trading seperti ini" (reel lantai trading
-- 3D: robot duduk di meja = sedang memegang posisi, nongkrong di kafe = menunggu sinyal, untung-rugi melayang di kepala,
-- robot yang menyentuh batas rugi otomatis dikeluarkan). Pilihan pemilik: Binance USDT-M futures, 8 robot 8 strategi,
-- modal sungguhan nanti $100 sampai $500.
--
-- Mesin: Edge Function `lantai-trading` (Deno, wilayah ap-south-1 Mumbai; API Binance memblokir server Amerika dan laptop
-- di Indonesia), dipanggil pg_cron tiap 5 menit lewat pg_net dengan kunci `lantai_kunci` (cs_rahasia, juga secret
-- LANTAI_KUNCI di fungsi). Semua robot mulai dengan uang SIMULASI memakai harga sungguhan. Uang sungguhan hanya jalan
-- kalau (1) pemilik sendiri menyalakan saklar `live` robot itu di kantor.markasku.my.id/lantai.html DAN (2) pemilik
-- sendiri memasang secret BINANCE_KEY dan BINANCE_SECRET di Edge Functions. Claude tidak memasang kunci bursa.
--
--   lantai_robot      : satu baris per robot: aturan (strategi, simbol, interval, modal, leverage, risiko, batas rugi),
--                       saklar live, status (aktif / dikeluarkan / jeda), kas simulasi, posisi terbuka, statistik
--   lantai_transaksi  : riwayat posisi yang sudah ditutup
--   lantai_modal      : potret nilai modal tiap putaran (dipangkas setelah 30 hari)
--   lantai_baca       : pemilik (sesi Kantor AI) membaca semuanya untuk lantai.html
--   lantai_atur       : pemilik menyalakan/mematikan live, menjeda, atau mengaktifkan lagi robot
-- =====================================================================================================
create table if not exists public.lantai_robot (
  id text primary key,
  urut int not null default 0,
  nama text not null,
  strategi text not null,
  simbol text not null,
  interval text not null,
  modal_awal numeric not null default 50,
  leverage int not null default 3,
  risiko numeric not null default 0.02,        -- rugi maksimal per transaksi (bagian dari kas) kalau stop loss kena
  batas_rugi numeric not null default 0.2,     -- robot dikeluarkan kalau modal turun sebanyak ini dari modal awal
  live boolean not null default false,
  status text not null default 'aktif' check (status in ('aktif', 'dikeluarkan', 'jeda')),
  kas numeric not null default 50,
  posisi jsonb,
  statistik jsonb not null default '{}'::jsonb,
  catatan text,
  diubah timestamptz not null default now()
);
create table if not exists public.lantai_transaksi (
  id bigserial primary key,
  robot text not null references public.lantai_robot(id),
  data jsonb not null,
  waktu timestamptz not null default now()
);
create index if not exists lantai_transaksi_waktu on public.lantai_transaksi (waktu desc);
create table if not exists public.lantai_modal (
  waktu timestamptz primary key default now(),
  total numeric not null,
  per_robot jsonb not null
);
alter table public.lantai_robot enable row level security;
alter table public.lantai_transaksi enable row level security;
alter table public.lantai_modal enable row level security;
revoke all on public.lantai_robot, public.lantai_transaksi, public.lantai_modal from public, anon, authenticated;

-- delapan robot awal: aturan ditulis sebelum robot berjalan
insert into public.lantai_robot (id, urut, nama, strategi, simbol, interval) values
  ('tren-btc',      1, 'Bara',  'ikut-tren',        'BTCUSDT',  '1h'),
  ('tembus-eth',    2, 'Gita',  'tembus-kisaran',   'ETHUSDT',  '1h'),
  ('rsi-sol',       3, 'Rizal', 'pantulan-rsi',     'SOLUSDT',  '15m'),
  ('tengah-bnb',    4, 'Nadia', 'kembali-ke-tengah','BNBUSDT',  '15m'),
  ('macd-xrp',      5, 'Fajar', 'momentum-macd',    'XRPUSDT',  '1h'),
  ('volume-doge',   6, 'Sinta', 'lonjakan-volume',  'DOGEUSDT', '15m'),
  ('funding-btc',   7, 'Yoga',  'lawan-funding',    'BTCUSDT',  '1h'),
  ('super-avax',    8, 'Laras', 'supertrend',       'AVAXUSDT', '1h')
on conflict (id) do nothing;

create or replace function public.lantai_baca(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  return jsonb_build_object('ok', true,
    'robot', coalesce((select jsonb_agg(to_jsonb(r) order by r.urut) from lantai_robot r), '[]'::jsonb),
    'transaksi', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'robot', t.robot, 'waktu', t.waktu) || t.data order by t.waktu desc) from (select * from lantai_transaksi order by waktu desc limit 60) t), '[]'::jsonb),
    'modal', coalesce((select jsonb_agg(jsonb_build_object('w', m.waktu, 't', m.total) order by m.waktu) from (
       select distinct on (date_trunc('hour', waktu)) waktu, total from lantai_modal where waktu > now() - interval '14 days' order by date_trunc('hour', waktu), waktu desc) m), '[]'::jsonb),
    'terakhir', (select max(waktu) from lantai_modal),
    'kunciBursa', (select count(*) > 0 from cs_rahasia where nama = 'lantai_bursa_siap'));
end $$;
grant execute on function public.lantai_baca(text) to anon, authenticated;

create or replace function public.lantai_atur(p_token text, p_robot text, p_aksi text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r lantai_robot;
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  select * into r from lantai_robot where id = p_robot; if r.id is null then return jsonb_build_object('ok', false, 'pesan', 'Robot tidak ada.'); end if;
  if p_aksi = 'live-nyala' then update lantai_robot set live = true, catatan = 'Uang sungguhan dinyalakan pemilik ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI'), diubah = now() where id = p_robot;
  elsif p_aksi = 'live-mati' then update lantai_robot set live = false, catatan = 'Kembali ke simulasi ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI'), diubah = now() where id = p_robot;
  elsif p_aksi = 'jeda' then update lantai_robot set status = 'jeda', diubah = now() where id = p_robot and status = 'aktif';
  elsif p_aksi = 'lanjut' then update lantai_robot set status = 'aktif', diubah = now() where id = p_robot and status = 'jeda';
  elsif p_aksi = 'mulai-ulang' then   -- robot yang dikeluarkan boleh dicoba lagi dari modal awal (riwayat tetap)
    update lantai_robot set status = 'aktif', kas = modal_awal, posisi = null, live = false, catatan = 'Dimulai ulang pemilik ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI'), diubah = now() where id = p_robot and status = 'dikeluarkan';
  else return jsonb_build_object('ok', false, 'pesan', 'Aksi tidak dikenal.'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.lantai_atur(text, text, text) to anon, authenticated;

-- pemicu: tiap 5 menit memanggil Edge Function di Mumbai; potret modal lebih dari 30 hari dipangkas
create or replace function public.lantai__tick() returns bigint language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from lantai_modal where waktu < now() - interval '30 days';
  return net.http_post('https://hzxfheydtrjhizbwbddh.supabase.co/functions/v1/lantai-trading',
    jsonb_build_object('sumber', 'cron'),
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-south-1', 'x-lantai-kunci', (select nilai from cs_rahasia where nama = 'lantai_kunci')),
    55000);
end $$;
revoke all on function public.lantai__tick() from public, anon, authenticated;
select cron.unschedule('lantai-trading') where exists (select 1 from cron.job where jobname = 'lantai-trading');
select cron.schedule('lantai-trading', '*/5 * * * *', $c$select public.lantai__tick()$c$);
notify pgrst, 'reload schema';

-- =====================================================================================================
-- DOMPET BERSAMA (13 Okt 2026, aturan pemilik): "kas nya tetap 100dollar tidak terpisah, 3 posisi sudah cukup ...
-- setelah nyampai 300dollar resiko nya 9dollar ... begitu seterusnya", rem darurat "saldo turun 40%", leverage
-- "sesuaikan dengan risk nya". Delapan robot memakai SATU saldo. Kolom lantai_robot.kas sekarang = untung-rugi bersih
-- robot itu sendiri (mulai 0), modal_awal/leverage/risiko/batas_rugi per robot tidak dipakai lagi oleh mesin.
--   tingkat       : patokan risiko. Risiko per transaksi = risiko_persen x tingkat ($100 -> $3). Saldo >= 3 x tingkat
--                   -> tingkat dikali 3 ($300 -> $9, $900 -> $27, ...). Tingkat tidak pernah turun.
--   maks_posisi   : posisi terbuka bersamaan paling banyak (3; rugi terburuk serentak 9% tingkat)
--   rem_persen    : saldo <= (1 - rem_persen) x tingkat -> semua posisi ditutup, status 'berhenti' sampai pemilik
--                   menyalakan lagi di lantai.html
--   keluar_persen : robot dikeluarkan kalau rugi bersihnya sendiri >= keluar_persen x tingkat (15% -> $15)
--   lev_maks      : batas atas leverage hitungan otomatis
-- =====================================================================================================
create table if not exists public.lantai_dompet (
  id int primary key default 1 check (id = 1),
  modal_awal numeric not null default 100,
  kas numeric not null default 100,
  ekuitas numeric not null default 100,
  tingkat numeric not null default 100,
  risiko_persen numeric not null default 0.03,
  maks_posisi int not null default 3,
  rem_persen numeric not null default 0.4,
  keluar_persen numeric not null default 0.15,
  lev_maks int not null default 20,
  puncak numeric not null default 100,
  status text not null default 'aktif' check (status in ('aktif', 'berhenti')),
  catatan text,
  mulai timestamptz not null default now(),
  diubah timestamptz not null default now()
);
alter table public.lantai_dompet enable row level security;
revoke all on public.lantai_dompet from public, anon, authenticated;
insert into public.lantai_dompet (id) values (1) on conflict (id) do nothing;
alter table public.lantai_robot alter column kas set default 0;

create or replace function public.lantai_baca(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  return jsonb_build_object('ok', true,
    'dompet', (select to_jsonb(d) from lantai_dompet d where id = 1),
    'robot', coalesce((select jsonb_agg(to_jsonb(r) order by r.urut) from lantai_robot r), '[]'::jsonb),
    'transaksi', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'robot', t.robot, 'waktu', t.waktu) || t.data order by t.waktu desc) from (select * from lantai_transaksi order by waktu desc limit 60) t), '[]'::jsonb),
    'modal', coalesce((select jsonb_agg(jsonb_build_object('w', m.waktu, 't', m.total) order by m.waktu) from (
       select distinct on (date_trunc('hour', waktu)) waktu, total from lantai_modal where waktu > now() - interval '14 days' order by date_trunc('hour', waktu), waktu desc) m), '[]'::jsonb),
    'terakhir', (select max(waktu) from lantai_modal),
    'kunciBursa', (select count(*) > 0 from cs_rahasia where nama = 'lantai_bursa_siap'));
end $$;

create or replace function public.lantai_atur(p_token text, p_robot text, p_aksi text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r lantai_robot;
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  if p_aksi = 'dompet-lanjut' then   -- setelah rem darurat: pemilik menyalakan lagi, tingkat dihitung ulang dari saldo sekarang
    update lantai_dompet set status = 'aktif', tingkat = greatest(ekuitas, 1), puncak = ekuitas,
      catatan = 'Dinyalakan lagi pemilik ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ', tingkat baru ' || round(ekuitas, 2), diubah = now()
      where id = 1 and status = 'berhenti';
    return jsonb_build_object('ok', true); end if;
  select * into r from lantai_robot where id = p_robot; if r.id is null then return jsonb_build_object('ok', false, 'pesan', 'Robot tidak ada.'); end if;
  if p_aksi = 'live-nyala' then update lantai_robot set live = true, catatan = 'Uang sungguhan dinyalakan pemilik ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI'), diubah = now() where id = p_robot;
  elsif p_aksi = 'live-mati' then update lantai_robot set live = false, catatan = 'Kembali ke simulasi ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI'), diubah = now() where id = p_robot;
  elsif p_aksi = 'jeda' then update lantai_robot set status = 'jeda', diubah = now() where id = p_robot and status = 'aktif';
  elsif p_aksi = 'lanjut' then update lantai_robot set status = 'aktif', diubah = now() where id = p_robot and status = 'jeda';
  elsif p_aksi = 'mulai-ulang' then   -- robot yang dikeluarkan boleh dicoba lagi; hitungan rugi bersihnya kembali 0 (riwayat tetap)
    update lantai_robot set status = 'aktif', kas = 0, posisi = null, live = false, catatan = 'Dimulai ulang pemilik ' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI'), diubah = now() where id = p_robot and status = 'dikeluarkan';
  else return jsonb_build_object('ok', false, 'pesan', 'Aksi tidak dikenal.'); end if;
  return jsonb_build_object('ok', true);
end $$;
notify pgrst, 'reload schema';
