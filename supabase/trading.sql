-- Raka, pemburu setup trading (agen `setup`, 6 Okt 2026). Hasil harian dari repo potret-pasar-crypto disimpan di sini
-- supaya pemilik membacanya di kantor.markasku.my.id/trading.html (pribadi, sesi pemilik Kantor AI).
--   trading_setup          : satu baris per tanggal: mesin (kandidat + siaga + gerbang), final (pilihan Raka), rapor, teks md
--   trading_setup_simpan   : workflow GitHub (KANTOR_KUNCI) menyimpan/menimpa sebagian kolom satu tanggal
--   trading_setup_baca     : pemilik (sesi Kantor AI) membaca N tanggal terakhir
create table if not exists public.trading_setup (
  tanggal date primary key,
  mesin jsonb, final jsonb, rapor jsonb, teks text,
  diubah timestamptz not null default now()
);
alter table public.trading_setup enable row level security;
revoke all on public.trading_setup from public, anon, authenticated;

create or replace function public.trading_setup_simpan(p_rahasia text, p_tanggal date, p_mesin jsonb default null, p_final jsonb default null, p_rapor jsonb default null, p_teks text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(p_rahasia), 0) < 32 or not exists (select 1 from kantor_pemilik where id = 1 and rahasia_hash = kantor__h(p_rahasia)) then return jsonb_build_object('ok', false, 'pesan', 'ditolak'); end if;
  insert into trading_setup(tanggal, mesin, final, rapor, teks) values (p_tanggal, p_mesin, p_final, p_rapor, left(p_teks, 60000))
    on conflict (tanggal) do update set mesin = coalesce(excluded.mesin, trading_setup.mesin), final = coalesce(excluded.final, trading_setup.final),
      rapor = coalesce(excluded.rapor, trading_setup.rapor), teks = coalesce(excluded.teks, trading_setup.teks), diubah = now();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.trading_setup_simpan(text, date, jsonb, jsonb, jsonb, text) to anon, authenticated;

create or replace function public.trading_setup_baca(p_token text, p_jumlah int default 7) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not kantor__sah(p_token) then return jsonb_build_object('ok', false, 'pesan', 'Sesi habis. Masuk lagi di Kantor AI.'); end if;
  return jsonb_build_object('ok', true, 'hari', coalesce((select jsonb_agg(to_jsonb(t) order by t.tanggal desc) from (select * from trading_setup order by tanggal desc limit least(greatest(p_jumlah, 1), 30)) t), '[]'::jsonb));
end $$;
grant execute on function public.trading_setup_baca(text, int) to anon, authenticated;
notify pgrst, 'reload schema';
