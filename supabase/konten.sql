-- Rina (agen sosmed): status draf postingan dan rahasia Instagram. 4 Oktober 2026. Dipasang ke project markasku
-- (satu rumah dengan Kantor AI dan Dina): node kantor-ai/alat/pasang-konten-db.mjs
--   konten_status            : per tanggal draf: draf | tahan | posting | terbit | gagal, plus permalink Instagram
--   konten_status_baca       : siapa saja (halaman konten.html dan workflow) membaca status satu tanggal
--   konten_status_set        : pemilik (sesi Kantor AI) mengubah status: tahan, lepas, posting sekarang
--   konten_status_tulis      : workflow GitHub (KANTOR_KUNCI) menandai terbit/gagal dengan permalink
--   konten_rahasia_baca      : workflow GitHub (KANTOR_KUNCI) membaca token Instagram dari cs_rahasia
--   cs_pasang_kunci diperluas: boleh menyimpan 'ig_token' (token Instagram, diperbarui tiap minggu oleh workflow)
create table if not exists public.konten_status (
  tanggal date primary key,
  status text not null default 'draf' check (status in ('draf', 'tahan', 'posting', 'terbit', 'gagal')),
  permalink text,
  catatan text,
  diubah timestamptz not null default now()
);
alter table public.konten_status enable row level security;
-- Format posting per tanggal (6 Okt 2026): null = ikut draf (index.json: Reels Selasa, Kamis, Sabtu), 'carousel' atau 'reels'.
alter table public.konten_status add column if not exists format text check (format in ('carousel', 'reels'));
revoke all on public.konten_status from public, anon, authenticated;

create or replace function public.konten_status_baca(p_tanggal date) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'tanggal', tanggal, 'status', status, 'permalink', permalink, 'catatan', catatan, 'format', format, 'diubah', diubah) from konten_status where tanggal = p_tanggal),
    jsonb_build_object('ok', true, 'tanggal', p_tanggal, 'status', 'draf')) $$;
grant execute on function public.konten_status_baca(date) to anon, authenticated;

create or replace function public.konten_status_set(p_token text, p_tanggal date, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  if p_status not in ('draf', 'tahan', 'posting') then return jsonb_build_object('ok', false, 'pesan', 'Status tidak dikenal.'); end if;
  if exists (select 1 from konten_status where tanggal = p_tanggal and status = 'terbit') then return jsonb_build_object('ok', false, 'pesan', 'Draf ini sudah terbit di Instagram.'); end if;
  insert into konten_status(tanggal, status) values (p_tanggal, p_status) on conflict (tanggal) do update set status = excluded.status, diubah = now();
  if p_status = 'posting' then insert into kantor_perintah(agen, perintah) values ('sosmed-posting', 'jalan'); end if;   -- dispatcher di laptop memicu ig-posting.yml
  return konten_status_baca(p_tanggal);
end $$;
grant execute on function public.konten_status_set(text, date, text) to anon, authenticated;

create or replace function public.konten_status_tulis(p_rahasia text, p_tanggal date, p_status text, p_permalink text default null, p_catatan text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'Kunci tidak sah.'); end if;
  insert into konten_status(tanggal, status, permalink, catatan) values (p_tanggal, p_status, p_permalink, p_catatan)
    on conflict (tanggal) do update set status = excluded.status, permalink = coalesce(excluded.permalink, konten_status.permalink), catatan = excluded.catatan, diubah = now();
  return konten_status_baca(p_tanggal);
end $$;
grant execute on function public.konten_status_tulis(text, date, text, text, text) to anon, authenticated;

create or replace function public.konten_rahasia_baca(p_rahasia text, p_nama text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'Kunci tidak sah.'); end if;
  if p_nama not in ('ig_token') then return jsonb_build_object('ok', false, 'pesan', 'Nama tidak boleh dibaca.'); end if;
  select * into r from cs_rahasia where nama = p_nama;
  if r is null then return jsonb_build_object('ok', false, 'pesan', 'Belum dipasang.'); end if;
  return jsonb_build_object('ok', true, 'nilai', r.nilai, 'diubah', r.diubah);
end $$;
grant execute on function public.konten_rahasia_baca(text, text) to anon, authenticated;

-- cs_pasang_kunci boleh menyimpan token Instagram juga
create or replace function public.cs_pasang_kunci(p_rahasia text, p_nama text, p_nilai text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then
    return jsonb_build_object('ok', false, 'pesan', 'Kunci tidak sah.'); end if;
  if p_nama not in ('gemini', 'ig_token') or coalesce(length(p_nilai), 0) < 20 then return jsonb_build_object('ok', false, 'pesan', 'Nama atau nilai tidak sah.'); end if;
  insert into cs_rahasia(nama, nilai) values (p_nama, p_nilai) on conflict (nama) do update set nilai = excluded.nilai, diubah = now();
  return jsonb_build_object('ok', true, 'nama', p_nama, 'panjang', length(p_nilai));
end $$;

-- Pemilik (sesi Kantor AI) memasang token Instagram dari HP lewat konten.html, tanpa lewat laptop atau chat.
create or replace function public.konten_rahasia_set(p_token text, p_nama text, p_nilai text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  if p_nama not in ('ig_token') or coalesce(length(btrim(p_nilai)), 0) < 20 then return jsonb_build_object('ok', false, 'pesan', 'Token terlalu pendek atau nama tidak dikenal.'); end if;
  insert into cs_rahasia(nama, nilai) values (p_nama, btrim(p_nilai)) on conflict (nama) do update set nilai = excluded.nilai, diubah = now();
  return jsonb_build_object('ok', true, 'nama', p_nama, 'panjang', length(btrim(p_nilai)));
end $$;
grant execute on function public.konten_rahasia_set(text, text, text) to anon, authenticated;
-- Apakah token sudah ada (tanpa membuka nilainya)
create or replace function public.konten_rahasia_ada(p_token text, p_nama text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis.'); end if;
  select nama, length(nilai) as panjang, diubah into r from cs_rahasia where nama = p_nama;
  return jsonb_build_object('ok', true, 'ada', r is not null, 'panjang', r.panjang, 'diubah', r.diubah);
end $$;
grant execute on function public.konten_rahasia_ada(text, text) to anon, authenticated;

-- Pemilik (sesi Kantor AI) atau Manajer lewat jembatan (KANTOR_KUNCI) memilih format posting satu tanggal.
create or replace function public.konten_format_set(p_token text, p_tanggal date, p_format text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  if p_format not in ('carousel', 'reels') then return jsonb_build_object('ok', false, 'pesan', 'Format tidak dikenal.'); end if;
  if exists (select 1 from konten_status where tanggal = p_tanggal and status = 'terbit') then return jsonb_build_object('ok', false, 'pesan', 'Draf ini sudah terbit di Instagram.'); end if;
  insert into konten_status(tanggal, format) values (p_tanggal, p_format) on conflict (tanggal) do update set format = excluded.format, diubah = now();
  return konten_status_baca(p_tanggal);
end $$;
grant execute on function public.konten_format_set(text, date, text) to anon, authenticated;
create or replace function public.konten_format_tulis(p_rahasia text, p_tanggal date, p_format text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'Kunci tidak sah.'); end if;
  if p_format not in ('carousel', 'reels') then return jsonb_build_object('ok', false, 'pesan', 'Format tidak dikenal.'); end if;
  insert into konten_status(tanggal, format) values (p_tanggal, p_format) on conflict (tanggal) do update set format = excluded.format, diubah = now();
  return konten_status_baca(p_tanggal);
end $$;
grant execute on function public.konten_format_tulis(text, date, text) to anon, authenticated;
notify pgrst, 'reload schema';
