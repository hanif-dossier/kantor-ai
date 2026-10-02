-- Kantor AI: papan status semua karyawan AI pemilik (Supabase proyek "markasku", tabel berawalan kantor_).
-- Tidak memakai auth.users: pemilik masuk dengan sandi (seperti OFU). Semua tabel dikunci RLS tanpa kebijakan;
-- satu-satunya pintu adalah fungsi SECURITY DEFINER di bawah.
--   kantor_lapor(p_rahasia, ...)  : karyawan AI (workflow GitHub, n8n, routine) melapor mulai/selesai/gagal
--   kantor_masuk / kantor_keluar  : pemilik masuk dengan sandi -> token 30 hari
--   kantor_data(p_token)          : status terakhir tiap karyawan + riwayat + angka hari ini
--   kantor_perintah(p_token, ...) : pemilik menyuruh karyawan (antrean; dibaca pelapor saat jalan)
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.kantor_pemilik (
  id int primary key default 1 check (id = 1),
  sandi_hash text not null,
  rahasia_hash text not null,                 -- sha256 kunci pelapor (dipegang workflow/n8n)
  gagal int not null default 0,
  kunci_sampai timestamptz
);
create table if not exists public.kantor_sesi (
  token_hash text primary key,
  dibuat timestamptz not null default now(),
  kedaluwarsa timestamptz not null
);
-- Satu baris per laporan. agen = kode tetap (mis. 'briefing'), status: kerja | selesai | gagal | istirahat.
create table if not exists public.kantor_lapor (
  id bigserial primary key,
  agen text not null,
  status text not null,
  tugas text,                                 -- kalimat pendek: apa yang dikerjakan
  hasil text,                                 -- kalimat pendek hasilnya (opsional)
  tautan text,                                -- tautan hasil (opsional)
  sumber text,                                -- github | n8n | routine | claude-code
  jalan_id text,                              -- id run (untuk memasangkan mulai dengan selesai)
  token int,                                  -- token model AI yang dipakai (kalau ada)
  biaya numeric,                              -- rupiah (kalau ada)
  waktu timestamptz not null default now()
);
create index if not exists kantor_lapor_agen_waktu on public.kantor_lapor (agen, waktu desc);
create index if not exists kantor_lapor_waktu on public.kantor_lapor (waktu desc);
create table if not exists public.kantor_perintah (
  id bigserial primary key,
  agen text not null,
  perintah text not null,                     -- 'jalan' (suruh kerja sekarang) atau teks bebas
  dibuat timestamptz not null default now(),
  diambil timestamptz                         -- diisi pelapor saat perintah dibaca
);
alter table public.kantor_pemilik enable row level security;
alter table public.kantor_sesi enable row level security;
alter table public.kantor_lapor enable row level security;
alter table public.kantor_perintah enable row level security;

create or replace function public.kantor__h(t text) returns text language sql immutable
set search_path = public, extensions as $f$ select encode(extensions.digest(t, 'sha256'), 'hex') $f$;
create or replace function public.kantor__sah(p_token text) returns boolean language sql stable security definer
set search_path = public, extensions as $f$
  select exists (select 1 from public.kantor_sesi where token_hash = public.kantor__h(coalesce(p_token,'')) and kedaluwarsa > now()) $f$;

create or replace function public.kantor_masuk(p_sandi text) returns jsonb language plpgsql security definer
set search_path = public, extensions as $f$
declare v_hash text; v_kunci timestamptz; v_token text;
begin
  select sandi_hash, kunci_sampai into v_hash, v_kunci from kantor_pemilik where id = 1;
  if v_hash is null then return jsonb_build_object('ok', false, 'pesan', 'Kantor belum dipasang.'); end if;
  if v_kunci is not null and v_kunci > now() then
    return jsonb_build_object('ok', false, 'pesan', 'Terlalu banyak percobaan. Coba lagi pukul ' || to_char(v_kunci at time zone 'Asia/Jakarta', 'HH24:MI') || ' WIB.'); end if;
  if v_hash <> extensions.crypt(coalesce(p_sandi,''), v_hash) then
    update kantor_pemilik set kunci_sampai = case when gagal + 1 >= 5 then now() + interval '15 minutes' else kunci_sampai end, gagal = case when gagal + 1 >= 5 then 0 else gagal + 1 end where id = 1;
    return jsonb_build_object('ok', false, 'pesan', 'Sandi salah.'); end if;
  update kantor_pemilik set gagal = 0, kunci_sampai = null where id = 1;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  delete from kantor_sesi where kedaluwarsa < now();
  insert into kantor_sesi(token_hash, kedaluwarsa) values (kantor__h(v_token), now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token);
end $f$;
create or replace function public.kantor_keluar(p_token text) returns jsonb language sql security definer
set search_path = public, extensions as $f$
  with d as (delete from public.kantor_sesi where token_hash = public.kantor__h(coalesce(p_token,'')) returning 1) select jsonb_build_object('ok', true) $f$;

-- LAPOR dari karyawan AI. Kunci pelapor dicocokkan dengan hash; tanpa kunci yang benar laporan ditolak.
create or replace function public.kantor_lapor(p_rahasia text, p_agen text, p_status text, p_tugas text default null, p_hasil text default null,
  p_tautan text default null, p_sumber text default null, p_jalan_id text default null, p_token int default null, p_biaya numeric default null) returns jsonb language plpgsql security definer
set search_path = public, extensions as $f$
declare v_perintah jsonb;
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then
    return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  if p_status not in ('kerja', 'selesai', 'gagal', 'istirahat') then return jsonb_build_object('ok', false, 'pesan', 'status tidak dikenal'); end if;
  -- 'istirahat' = detak jantung (laptop tiap 10 menit): kalau baris terakhir agen ini juga istirahat, cukup waktunya yang
  -- digeser, supaya riwayat tidak penuh baris kosong.
  if p_status = 'istirahat' and exists (select 1 from (select status from kantor_lapor where agen = lower(trim(p_agen)) order by waktu desc limit 1) t where t.status = 'istirahat') then
    update kantor_lapor set waktu = now(), tugas = coalesce(left(p_tugas, 200), tugas)
      where id = (select id from kantor_lapor where agen = lower(trim(p_agen)) order by waktu desc limit 1);
  else
    insert into kantor_lapor(agen, status, tugas, hasil, tautan, sumber, jalan_id, token, biaya)
      values (lower(trim(p_agen)), p_status, left(p_tugas, 200), left(p_hasil, 300), left(p_tautan, 500), p_sumber, p_jalan_id, p_token, p_biaya);
  end if;
  -- perintah yang menunggu untuk agen ini ikut dikembalikan (dan ditandai diambil)
  with p as (update kantor_perintah set diambil = now() where agen = lower(trim(p_agen)) and diambil is null returning perintah, dibuat)
  select coalesce(jsonb_agg(jsonb_build_object('perintah', perintah, 'dibuat', dibuat)), '[]'::jsonb) into v_perintah from p;
  delete from kantor_lapor where waktu < now() - interval '90 days';
  return jsonb_build_object('ok', true, 'perintah', v_perintah);
end $f$;

-- DATA untuk halaman kantor: laporan terakhir per agen, 12 laporan terakhir tiap agen, dan ringkasan hari ini (WIB).
create or replace function public.kantor_data(p_token text) returns jsonb language plpgsql stable security definer
set search_path = public, extensions as $f$
declare v_awal timestamptz := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi.'); end if;
  return jsonb_build_object('ok', true, 'sekarang', now(),
    'terakhir', coalesce((select jsonb_object_agg(agen, baris) from (
        select distinct on (agen) agen, to_jsonb(l) baris from kantor_lapor l order by agen, waktu desc) t), '{}'::jsonb),
    'riwayat', coalesce((select jsonb_object_agg(agen, baris) from (
        select agen, jsonb_agg(to_jsonb(l) order by waktu desc) baris from (
          select *, row_number() over (partition by agen order by waktu desc) rn from kantor_lapor) l where rn <= 12 group by agen) t), '{}'::jsonb),
    'hariIni', (select jsonb_build_object('selesai', count(*) filter (where status = 'selesai'), 'gagal', count(*) filter (where status = 'gagal'),
        'token', coalesce(sum(token), 0), 'biaya', coalesce(sum(biaya), 0)) from kantor_lapor where waktu >= v_awal),
    'perintah', coalesce((select jsonb_agg(to_jsonb(p) order by dibuat desc) from kantor_perintah p where diambil is null), '[]'::jsonb));
end $f$;

create or replace function public.kantor_perintah(p_token text, p_agen text, p_perintah text) returns jsonb language plpgsql security definer
set search_path = public, extensions as $f$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi.'); end if;
  insert into kantor_perintah(agen, perintah) values (lower(trim(p_agen)), left(coalesce(p_perintah, 'jalan'), 300));
  return jsonb_build_object('ok', true);
end $f$;
-- ANTREAN untuk pemicu dari laptop (alat/jalankan-perintah.mjs): perintah yang belum diambil untuk daftar agen GitHub.
create or replace function public.kantor_antrean(p_rahasia text, p_agen text[]) returns jsonb language plpgsql security definer
set search_path = public, extensions as $f$
declare v jsonb;
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then
    return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  with p as (update kantor_perintah set diambil = now() where agen = any(p_agen) and diambil is null returning agen, perintah, dibuat)
  select coalesce(jsonb_agg(jsonb_build_object('agen', agen, 'perintah', perintah, 'dibuat', dibuat)), '[]'::jsonb) into v from p;
  return jsonb_build_object('ok', true, 'perintah', v);
end $f$;
create or replace function public.kantor_ganti_sandi(p_token text, p_lama text, p_baru text) returns jsonb language plpgsql security definer
set search_path = public, extensions as $f$
declare v_hash text;
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi.'); end if;
  select sandi_hash into v_hash from kantor_pemilik where id = 1;
  if v_hash <> extensions.crypt(coalesce(p_lama,''), v_hash) then return jsonb_build_object('ok', false, 'pesan', 'Sandi lama salah.'); end if;
  if length(coalesce(p_baru,'')) < 8 then return jsonb_build_object('ok', false, 'pesan', 'Sandi baru minimal 8 karakter.'); end if;
  update kantor_pemilik set sandi_hash = extensions.crypt(p_baru, extensions.gen_salt('bf', 10)) where id = 1;
  return jsonb_build_object('ok', true);
end $f$;

revoke all on function public.kantor__h(text), public.kantor__sah(text) from public, anon, authenticated;
grant execute on function public.kantor_masuk(text), public.kantor_keluar(text), public.kantor_lapor(text,text,text,text,text,text,text,text,int,numeric),
  public.kantor_data(text), public.kantor_perintah(text,text,text), public.kantor_ganti_sandi(text,text,text), public.kantor_antrean(text,text[]) to anon, authenticated;
notify pgrst, 'reload schema';
