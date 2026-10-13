-- Aset dompet (13 Okt 2026): tiap pagi 06.30 WIB fungsi Edge `aset-dompet` dipanggil dengan {"sinkron": true} supaya nilai
-- aset crypto di Keuangan Markasku (markas_dokumen keuangan/aset) sama dengan saldo sungguhan (Bybit, Keplr, MetaMask
-- termasuk staking). Kunci pemanggil = cs_rahasia lantai_kunci (sama dengan pemicu Lantai Trading).
create or replace function public.aset__sinkron() returns bigint language plpgsql security definer set search_path = public, extensions as $$
begin
  return net.http_post('https://hzxfheydtrjhizbwbddh.supabase.co/functions/v1/aset-dompet', jsonb_build_object('sinkron', true), '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-southeast-1', 'x-kunci-pemilik', (select nilai from cs_rahasia where nama = 'lantai_kunci')), 55000);
end $$;
revoke all on function public.aset__sinkron() from public, anon, authenticated;
select cron.unschedule('aset-sinkron-pagi') where exists (select 1 from cron.job where jobname = 'aset-sinkron-pagi');
select cron.schedule('aset-sinkron-pagi', '30 23 * * *', $c$select public.aset__sinkron()$c$);
