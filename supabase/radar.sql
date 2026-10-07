-- Pemicu radar (Dion) dari pg_cron (7 Okt 2026). Jadwal GitHub '17 */3 * * *' hanya jalan 3 sampai 4 kali sehari
-- (GitHub menunda dan membuang jadwal repo kecil), jadi radar dipicu dari sini tiap 3 jam lewat workflow_dispatch,
-- sama seperti posting Rina (konten__picu_posting). Token GitHub di cs_rahasia 'github_token'.
create or replace function public.kantor__picu_radar() returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare tok text;
begin
  select nilai into tok from cs_rahasia where nama = 'github_token'; if tok is null then return null; end if;
  return net.http_post('https://api.github.com/repos/hanif-dossier/laporan-harian/actions/workflows/radar-peringatan.yml/dispatches',
    jsonb_build_object('ref', 'main'), '{}'::jsonb,
    jsonb_build_object('Authorization', 'Bearer ' || tok, 'Accept', 'application/vnd.github+json', 'User-Agent', 'kantor-ai', 'Content-Type', 'application/json'), 15000);
end $$;
revoke all on function public.kantor__picu_radar() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'dion-radar-3jam';
select cron.schedule('dion-radar-3jam', '17 */3 * * *', $c$select public.kantor__picu_radar()$c$);
