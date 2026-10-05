-- Rina membalas komentar dan DM Instagram (6 Okt 2026). Dipasang ke project markasku: node kantor-ai/alat/pasang-ig-balas.mjs
-- Alur:
--   pg_cron tiap 2 menit -> ig__tick():
--     1. mengolah jawaban Instagram dari putaran sebelumnya (pg_net asinkron): daftar media -> minta komentar tiap media
--        yang punya komentar; komentar dan DM baru (setelah ig_atur.mulai, bukan dari akun sendiri, belum dibalas)
--        masuk ke ig_masuk berstatus 'baru'
--     2. meminta data terbaru: /me/media dan /me/conversations
--     3. pesan 'baru' (dan yang macet lebih dari 30 menit, paling banyak 3 kali) dikirim ke repo privat
--        hanif-dossier/rina-balas lewat repository_dispatch 'masuk' -> workflow menulis masuk/<id>.json -> push memicu
--        routine Claude "Rina: balas komentar dan DM" -> routine menulis balas/<id>.json -> workflow mengirim balasan ke
--        Instagram dan mencatatnya di sini (ig_balas_catat)
--   Pemilik: ig_atur_baca / ig_atur_set (sesi Kantor AI) di kantor.markasku.my.id/konten.html.
create table if not exists public.ig_atur (
  id int primary key default 1 check (id = 1),
  aktif boolean not null default true,
  mulai timestamptz not null default now(),            -- komentar dan DM sebelum waktu ini tidak dibalas
  akun text not null default 'hanif.dossiercrypto',
  akun_id text not null default '17841407669154893',
  terakhir timestamptz
);
insert into public.ig_atur(id) values (1) on conflict (id) do nothing;
create table if not exists public.ig_masuk (
  id text primary key,                                  -- id komentar atau id pesan DM dari Instagram
  jenis text not null check (jenis in ('komentar', 'dm')),
  induk text,                                           -- komentar: id media; dm: id percakapan
  dari_id text, dari_nama text, isi text,
  konteks jsonb,                                        -- dm: beberapa pesan terakhir percakapan
  waktu timestamptz,
  status text not null default 'baru' check (status in ('baru', 'dikirim', 'dibalas', 'dilewati', 'gagal')),
  coba int not null default 0, dikirim timestamptz,
  balasan text, dibalas timestamptz, catatan text,
  dibuat timestamptz not null default now()
);
create index if not exists ig_masuk_status on public.ig_masuk (status, waktu);
create table if not exists public.ig_tarik (req bigint primary key, jenis text not null, induk text, dibuat timestamptz not null default now());
alter table public.ig_atur enable row level security; alter table public.ig_masuk enable row level security; alter table public.ig_tarik enable row level security;
revoke all on public.ig_atur, public.ig_masuk, public.ig_tarik from public, anon, authenticated;

create or replace function public.ig__tick() returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a ig_atur; tok text; gh text; r record; j jsonb; m jsonb; c jsonb; msg jsonb; v jsonb; hdr jsonb; nid bigint; n_baru int := 0; n_kirim int := 0;
  G constant text := 'https://graph.instagram.com/v23.0';
begin
  select * into a from ig_atur where id = 1;
  if not a.aktif then return jsonb_build_object('ok', true, 'aktif', false); end if;
  select nilai into tok from cs_rahasia where nama = 'ig_token';
  if tok is null then return jsonb_build_object('ok', false, 'pesan', 'token Instagram belum ada'); end if;
  hdr := jsonb_build_object('Authorization', 'Bearer ' || tok);

  -- 1. olah jawaban putaran sebelumnya
  for r in select t.req, t.jenis, t.induk, h.status_code, h.content from ig_tarik t join net._http_response h on h.id = t.req loop
    begin
      if r.status_code = 200 then
        j := r.content::jsonb;
        if r.jenis = 'media' then
          for m in select * from jsonb_array_elements(coalesce(j->'data', '[]'::jsonb)) loop
            if coalesce((m->>'comments_count')::int, 0) > 0 and (m->>'timestamp')::timestamptz > now() - interval '45 days' then
              nid := net.http_get(G || '/' || (m->>'id') || '/comments', jsonb_build_object('fields', 'id,text,username,from,timestamp,replies{id,username,from}', 'limit', '50'), hdr, 10000);
              insert into ig_tarik(req, jenis, induk) values (nid, 'komentar', m->>'id');
            end if;
          end loop;
        elsif r.jenis = 'komentar' then
          for c in select * from jsonb_array_elements(coalesce(j->'data', '[]'::jsonb)) loop
            if lower(coalesce(c->>'username', c#>>'{from,username}', '')) <> a.akun
               and (c->>'timestamp')::timestamptz > a.mulai
               and not exists (select 1 from jsonb_array_elements(coalesce(c#>'{replies,data}', '[]'::jsonb)) x where lower(coalesce(x->>'username', x#>>'{from,username}', '')) = a.akun) then
              insert into ig_masuk(id, jenis, induk, dari_id, dari_nama, isi, waktu)
                values (c->>'id', 'komentar', r.induk, c#>>'{from,id}', coalesce(c->>'username', c#>>'{from,username}'), c->>'text', (c->>'timestamp')::timestamptz)
                on conflict (id) do nothing;
              if found then n_baru := n_baru + 1; end if;
            end if;
          end loop;
        elsif r.jenis = 'dm' then
          for c in select * from jsonb_array_elements(coalesce(j->'data', '[]'::jsonb)) loop
            msg := c#>'{messages,data,0}';   -- pesan terbaru percakapan
            if msg is not null and lower(coalesce(msg#>>'{from,username}', '')) <> a.akun and coalesce(msg#>>'{from,id}', '') <> a.akun_id
               and (msg->>'created_time')::timestamptz > a.mulai then
              insert into ig_masuk(id, jenis, induk, dari_id, dari_nama, isi, konteks, waktu)
                values (msg->>'id', 'dm', c->>'id', msg#>>'{from,id}', msg#>>'{from,username}', msg->>'message', c#>'{messages,data}', (msg->>'created_time')::timestamptz)
                on conflict (id) do nothing;
              if found then n_baru := n_baru + 1; end if;
            end if;
          end loop;
        end if;
      end if;
    exception when others then null;   -- satu jawaban rusak tidak menghentikan yang lain
    end;
    delete from ig_tarik where req = r.req;
  end loop;
  delete from ig_tarik where dibuat < now() - interval '10 minutes';

  -- 2. minta data terbaru
  nid := net.http_get(G || '/me/media', jsonb_build_object('fields', 'id,timestamp,comments_count', 'limit', '15'), hdr, 10000);
  insert into ig_tarik(req, jenis) values (nid, 'media');
  nid := net.http_get(G || '/me/conversations', jsonb_build_object('platform', 'instagram', 'fields', 'id,updated_time,messages.limit(6){id,from,message,created_time}', 'limit', '20'), hdr, 10000);
  insert into ig_tarik(req, jenis) values (nid, 'dm');

  -- 3. kirim pesan baru ke Rina (routine Claude) lewat GitHub
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'jenis', jenis, 'induk', induk, 'dari_id', dari_id, 'dari', dari_nama, 'isi', left(coalesce(isi, ''), 1000), 'konteks', konteks, 'waktu', waktu) order by waktu), '[]'::jsonb)
    into v from (select * from ig_masuk where status = 'baru' or (status = 'dikirim' and dikirim < now() - interval '30 minutes' and coba < 3) order by waktu limit 10) x;
  if jsonb_array_length(v) > 0 then
    select nilai into gh from cs_rahasia where nama = 'github_token';
    if gh is not null then
      perform net.http_post('https://api.github.com/repos/hanif-dossier/rina-balas/dispatches',
        jsonb_build_object('event_type', 'masuk', 'client_payload', jsonb_build_object('pesan', v)), '{}'::jsonb,
        jsonb_build_object('Authorization', 'Bearer ' || gh, 'Accept', 'application/vnd.github+json', 'User-Agent', 'kantor-ai', 'Content-Type', 'application/json'), 15000);
      update ig_masuk set status = 'dikirim', dikirim = now(), coba = coba + 1 where id in (select x->>'id' from jsonb_array_elements(v) x);
      n_kirim := jsonb_array_length(v);
    end if;
  end if;
  update ig_atur set terakhir = now() where id = 1;
  return jsonb_build_object('ok', true, 'baru', n_baru, 'dikirim', n_kirim);
end $$;
revoke all on function public.ig__tick() from public, anon, authenticated;

-- Workflow rina-balas (KANTOR_KUNCI): status beberapa pesan, lalu mencatat hasil pengiriman.
create or replace function public.ig_balas_status(p_rahasia text, p_ids text[]) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  return jsonb_build_object('ok', true, 'status', coalesce((select jsonb_object_agg(id, status) from ig_masuk where id = any(p_ids)), '{}'::jsonb));
end $$;
grant execute on function public.ig_balas_status(text, text[]) to anon, authenticated;
create or replace function public.ig_balas_catat(p_rahasia text, p_id text, p_status text, p_balasan text default null, p_catatan text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  if p_status not in ('dibalas', 'dilewati', 'gagal') then return jsonb_build_object('ok', false, 'pesan', 'status tidak dikenal'); end if;
  update ig_masuk set status = p_status, balasan = left(p_balasan, 2000), catatan = left(p_catatan, 500), dibalas = case when p_status = 'dibalas' then now() else dibalas end where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
grant execute on function public.ig_balas_catat(text, text, text, text, text) to anon, authenticated;

-- Pemilik (sesi Kantor AI): melihat dan menyalakan/mematikan balasan otomatis.
create or replace function public.ig_atur_baca(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare a ig_atur;
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  select * into a from ig_atur where id = 1;
  return jsonb_build_object('ok', true, 'aktif', a.aktif, 'mulai', a.mulai, 'terakhir', a.terakhir,
    'hariIni', (select count(*) from ig_masuk where status = 'dibalas' and dibalas >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'),
    'menunggu', (select count(*) from ig_masuk where status in ('baru', 'dikirim')),
    'pesan', coalesce((select jsonb_agg(jsonb_build_object('jenis', jenis, 'dari', dari_nama, 'isi', left(coalesce(isi, ''), 300), 'status', status, 'balasan', left(coalesce(balasan, ''), 400), 'catatan', catatan, 'waktu', waktu) order by waktu desc) from (select * from ig_masuk order by waktu desc limit 20) x), '[]'::jsonb));
end $$;
grant execute on function public.ig_atur_baca(text) to anon, authenticated;
create or replace function public.ig_atur_set(p_token text, p_aktif boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  -- menyalakan lagi: pesan selama mati tidak dibalas mundur
  update ig_atur set aktif = p_aktif, mulai = case when p_aktif and not aktif then now() else mulai end where id = 1;
  return ig_atur_baca(p_token);
end $$;
grant execute on function public.ig_atur_set(text, boolean) to anon, authenticated;

-- Jadwal tiap 2 menit
select cron.unschedule(jobid) from cron.job where jobname = 'rina-ig-balas';
select cron.schedule('rina-ig-balas', '*/2 * * * *', $c$select public.ig__tick()$c$);
notify pgrst, 'reload schema';
