// Aset dompet (13 Okt 2026): saldo crypto pemilik langsung dari bursa, untuk My Little Brain (hanif-dossier.github.io/
// hanif-dashboard/). Pemilik: "biar aset saya tidak salah dalam melihat aset mending lihat wallet saya aja", BTC di Bybit.
// - Hanya menjawab akun Markasku pemilik (JWT Supabase Auth diperiksa, UUID harus sama).
// - Kunci Bybit BACA-SAJA dipasang pemilik sendiri sebagai secret BYBIT_KEY dan BYBIT_SECRET (Edge Functions → Secrets).
// - Membaca akun Unified Trading dan Funding; harga dari ticker spot Bybit, kurs USD ke Rupiah dari CoinGecko (USDT).
// - Dipanggil dari wilayah Asia (header x-region ap-southeast-1) karena Bybit memblokir sebagian negara.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PEMILIK = 'ac358e3f-0316-48eb-a09a-3ac6ee8e0739';
const KEY = Deno.env.get('BYBIT_KEY') ?? '', SECRET = Deno.env.get('BYBIT_SECRET') ?? '', BYBIT = 'https://api.bybit.com';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-region', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const jawab = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function tanda(teks: string) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(teks)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function bybit(jalur: string, q: Record<string, string>) { const qs = new URLSearchParams(q).toString(), ts = String(Date.now()), rw = '10000';
  const r = await fetch(`${BYBIT}${jalur}?${qs}`, { headers: { 'X-BAPI-API-KEY': KEY, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': rw, 'X-BAPI-SIGN': await tanda(ts + KEY + rw + qs) } });
  const j = await r.json(); if (j.retCode !== 0) throw new Error(`${jalur}: ${j.retCode} ${j.retMsg}`); return j.result; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await sb.auth.getUser(jwt); if (u?.user?.id !== PEMILIK) return jawab({ ok: false, pesan: 'Hanya pemilik.' }, 401);
  if (!KEY || !SECRET) return jawab({ ok: true, siap: false, pesan: 'Kunci Bybit baca-saja belum dipasang.' });
  try {
    const per: Record<string, { simbol: string; jumlah: number; akun: Record<string, number> }> = {};
    const tambah = (c: string, n: number, akun: string) => { if (!n) return; const k = per[c] ??= { simbol: c, jumlah: 0, akun: {} }; k.jumlah += n; k.akun[akun] = (k.akun[akun] || 0) + n; };
    const uni = await bybit('/v5/account/wallet-balance', { accountType: 'UNIFIED' }).catch(() => null);
    for (const a of uni?.list ?? []) for (const c of a.coin ?? []) tambah(c.coin, +c.walletBalance || 0, 'Unified Trading');
    const dana = await bybit('/v5/asset/transfer/query-account-coins-balance', { accountType: 'FUND' }).catch(() => null);
    for (const c of dana?.balance ?? []) tambah(c.coin, +c.walletBalance || 0, 'Funding');
    const stabil = new Set(['USDT', 'USDC', 'USDE', 'FDUSD', 'DAI']);
    const koin = await Promise.all(Object.values(per).map(async k => {
      let harga = stabil.has(k.simbol) ? 1 : 0;
      if (!harga) { const t = await fetch(`${BYBIT}/v5/market/tickers?category=spot&symbol=${k.simbol}USDT`).then(r => r.json()).catch(() => null); harga = +(t?.result?.list?.[0]?.lastPrice ?? 0); }
      return { ...k, hargaUsd: harga, nilaiUsd: k.jumlah * harga }; }));
    const kurs = +((await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr').then(r => r.json()).catch(() => null))?.tether?.idr ?? 0);
    koin.sort((a, b) => b.nilaiUsd - a.nilaiUsd); const totalUsd = koin.reduce((a, k) => a + k.nilaiUsd, 0);
    return jawab({ ok: true, siap: true, sumber: 'Bybit', koin: koin.map(k => ({ ...k, nilaiIdr: kurs ? k.nilaiUsd * kurs : null })), totalUsd, totalIdr: kurs ? totalUsd * kurs : null, kurs, waktu: new Date().toISOString() });
  } catch (e) { return jawab({ ok: false, pesan: String((e as Error).message || e).slice(0, 200) }); }
});
