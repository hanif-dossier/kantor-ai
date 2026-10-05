-- Ruang Manajer (5 Oktober 2026): pemilik menulis perintah bebas di Kantor AI; Manajer (routine Claude di cloud)
-- menerima, membagi ke karyawan, memeriksa, dan membalas di ruang yang sama.
--   kantor_chat             : percakapan. dari = 'pemilik' | 'manajer' | kode agen. status pesan pemilik: baru | diambil | selesai
--   kantor_chat_kirim       : pemilik (sesi) mengirim pesan; lewat pg_net pesan itu ditulis ke repo privat laporan-harian
--                             (perintah/<id>.json) supaya routine Manajer terpicu dan bisa membacanya (routine tidak punya kunci)
--   kantor_chat_baca        : pemilik membaca percakapan (sejak id tertentu)
--   kantor_chat_balas       : workflow GitHub (KANTOR_KUNCI) menulis balasan Manajer atau agen dan menandai pesan selesai
--   kantor_chat_antrean     : workflow GitHub (KANTOR_KUNCI) mengambil pesan pemilik yang belum diambil
create table if not exists public.kantor_chat (
  id bigserial primary key,
  dari text not null,
  isi text not null,
  status text not null default 'baru' check (status in ('baru', 'diambil', 'selesai', 'info')),
  ref bigint,                                 -- balasan untuk pesan pemilik nomor berapa
  tindakan jsonb,                             -- tindakan yang dilakukan Manajer (ringkasan terstruktur)
  dibuat timestamptz not null default now()
);
create index if not exists kantor_chat_dibuat on public.kantor_chat (dibuat);
alter table public.kantor_chat enable row level security;
revoke all on public.kantor_chat from public, anon, authenticated;

-- Mengetuk repo privat lewat GitHub repository_dispatch (pg_net, asinkron; pg_net tidak punya PUT untuk contents API).
-- Workflow kantor-chat.yml menerima event "perintah" dan menulis perintah/<id>.json; push itu memicu routine Manajer.
create or replace function public.kantor__ke_github(p_id bigint, p_isi text, p_dibuat timestamptz) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  select nilai into tok from cs_rahasia where nama = 'github_token'; if tok is null then return null; end if;
  return net.http_post('https://api.github.com/repos/hanif-dossier/laporan-harian/dispatches',
    jsonb_build_object('event_type', 'perintah', 'client_payload', jsonb_build_object('id', p_id, 'isi', p_isi, 'dibuat', p_dibuat)), '{}'::jsonb,
    jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json', 'User-Agent', 'kantor-ai', 'Content-Type', 'application/json'), 15000);
end $$;
revoke all on function public.kantor__ke_github(bigint, text, timestamptz) from public, anon, authenticated;

create or replace function public.kantor_chat_kirim(p_token text, p_isi text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_net bigint; v_isi text := left(btrim(p_isi), 2000);
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi.'); end if;
  if coalesce(length(v_isi), 0) = 0 then return jsonb_build_object('ok', false, 'pesan', 'Pesannya kosong.'); end if;
  insert into kantor_chat(dari, isi, status) values ('pemilik', v_isi, 'baru') returning id into v_id;
  v_net := kantor__ke_github(v_id, v_isi, now());
  return jsonb_build_object('ok', true, 'id', v_id, 'dikirim', v_net is not null);
end $$;
grant execute on function public.kantor_chat_kirim(text, text) to anon, authenticated;

create or replace function public.kantor_chat_baca(p_token text, p_sejak bigint default 0) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi.'); end if;
  return jsonb_build_object('ok', true, 'pesan', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from (select * from kantor_chat where id > p_sejak order by id desc limit 80) c), '[]'::jsonb));
end $$;
grant execute on function public.kantor_chat_baca(text, bigint) to anon, authenticated;

create or replace function public.kantor_chat_balas(p_rahasia text, p_dari text, p_isi text, p_ref bigint default null, p_tindakan jsonb default null, p_status_ref text default 'selesai') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  insert into kantor_chat(dari, isi, status, ref, tindakan) values (left(coalesce(p_dari, 'manajer'), 40), left(p_isi, 4000), 'info', p_ref, p_tindakan) returning id into v_id;
  if p_ref is not null then update kantor_chat set status = p_status_ref where id = p_ref and dari = 'pemilik'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.kantor_chat_balas(text, text, text, bigint, jsonb, text) to anon, authenticated;

create or replace function public.kantor_chat_antrean(p_rahasia text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  with p as (update kantor_chat set status = 'diambil' where dari = 'pemilik' and status = 'baru' returning id, isi, dibuat)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'isi', isi, 'dibuat', dibuat) order by id), '[]'::jsonb) into v from p;
  return jsonb_build_object('ok', true, 'pesan', v);
end $$;
grant execute on function public.kantor_chat_antrean(text) to anon, authenticated;

-- cs_pasang_kunci boleh menyimpan github_token juga (dipasang dari laptop lewat pasang-konten-db.mjs)
create or replace function public.cs_pasang_kunci(p_rahasia text, p_nama text, p_nilai text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then
    return jsonb_build_object('ok', false, 'pesan', 'Kunci tidak sah.'); end if;
  if p_nama not in ('gemini', 'ig_token', 'github_token') or coalesce(length(p_nilai), 0) < 20 then return jsonb_build_object('ok', false, 'pesan', 'Nama atau nilai tidak sah.'); end if;
  insert into cs_rahasia(nama, nilai) values (p_nama, p_nilai) on conflict (nama) do update set nilai = excluded.nilai, diubah = now();
  return jsonb_build_object('ok', true, 'nama', p_nama, 'panjang', length(p_nilai));
end $$;

-- Ringkasan keadaan kantor untuk Manajer (ditulis workflow jembatan ke data/kantor-ringkas.json)
create or replace function public.kantor_ringkas(p_rahasia text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hari timestamptz := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  return jsonb_build_object('ok', true, 'dibuat', now(), 'hariIni', (now() at time zone 'Asia/Jakarta')::date,
    'laporan', coalesce((select jsonb_agg(jsonb_build_object('agen', agen, 'status', status, 'tugas', tugas, 'hasil', hasil, 'tautan', tautan, 'waktu', waktu, 'token', token) order by waktu desc) from (select * from kantor_lapor where waktu >= v_hari - interval '1 day' order by waktu desc limit 120) l), '[]'::jsonb),
    'terakhirPerAgen', coalesce((select jsonb_object_agg(agen, jsonb_build_object('status', status, 'tugas', tugas, 'waktu', waktu)) from (select distinct on (agen) agen, status, tugas, waktu from kantor_lapor order by agen, waktu desc) t), '{}'::jsonb),
    'perintahMenunggu', coalesce((select jsonb_agg(jsonb_build_object('agen', agen, 'perintah', perintah, 'dibuat', dibuat)) from kantor_perintah where diambil is null), '[]'::jsonb),
    'konten', coalesce((select jsonb_build_object('tanggal', tanggal, 'status', status, 'permalink', permalink, 'catatan', catatan) from konten_status order by tanggal desc limit 1), '{}'::jsonb),
    'dina', jsonb_build_object('percakapanHariIni', (select count(distinct sesi) from cs_percakapan where waktu >= v_hari), 'pesanHariIni', (select count(*) from cs_percakapan where waktu >= v_hari and peran = 'pengunjung'), 'tokenHariIni', (select coalesce(sum(token), 0) from cs_percakapan where waktu >= v_hari)),
    'chat', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'dari', dari, 'isi', isi, 'status', status, 'ref', ref, 'dibuat', dibuat) order by id) from (select * from kantor_chat order by id desc limit 40) c), '[]'::jsonb));
end $$;
grant execute on function public.kantor_ringkas(text) to anon, authenticated;

-- Perintah ke agen oleh Manajer lewat workflow (KANTOR_KUNCI), bukan sesi pemilik
create or replace function public.kantor_perintah_kunci(p_rahasia text, p_agen text, p_perintah text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  insert into kantor_perintah(agen, perintah) values (lower(trim(p_agen)), left(coalesce(p_perintah, 'jalan'), 2000));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.kantor_perintah_kunci(text, text, text) to anon, authenticated;
