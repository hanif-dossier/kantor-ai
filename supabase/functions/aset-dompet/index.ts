// Aset dompet (13 Okt 2026): saldo crypto pemilik dari sumbernya langsung, untuk My Little Brain (hanif-dossier.github.io/
// hanif-dashboard/). Pemilik: "biar aset saya tidak salah dalam melihat aset mending lihat wallet saya aja".
//   - Bybit (BTC, USDT): kunci BACA-SAJA milik pemilik, secret BYBIT_KEY dan BYBIT_SECRET (dipasang pemilik sendiri).
//   - Keplr / Injective (INJ): saldo wallet + delegasi staking + hadiah belum diklaim + unbonding, dari LCD publik.
//   - MetaMask / Monad (MON): saldo wallet + staking bawaan Monad (precompile 0x…1000: getDelegations, getDelegator,
//     getWithdrawalRequest untuk MON yang sedang ditarik).
//   - MetaMask / Ethereum (ZAMA): saldo token + saham staking resmi Zama (OperatorStaking ERC4626, previewRedeem).
// Harga dan kurs Rupiah dari CoinGecko. Hanya menjawab akun Markasku pemilik (JWT), atau laptop pemilik (kunci server).
// Alamat di bawah alamat PUBLIK pemilik (13 Okt 2026); tidak ada kunci privat apa pun di sini.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PEMILIK = 'ac358e3f-0316-48eb-a09a-3ac6ee8e0739';
const EVM = '0x83C4ab9eef5Fce5A23F049fD1b140911E1cbc0aA', INJ = 'inj1a4nfnksh864zxcze5z0ftcutcudxnakgmxxzsf';
const KEY = Deno.env.get('BYBIT_KEY') ?? '', SECRET = Deno.env.get('BYBIT_SECRET') ?? '', BYBIT = 'https://api.bybit.com';
const RPC_ETH = 'https://ethereum-rpc.publicnode.com', RPC_MON = 'https://rpc.monad.xyz', LCD_INJ = 'https://sentry.lcd.injective.network';
const ZAMA = '0xA12CC123ba206d4031D1c7f6223D1C2Ec249f4f3';
// kontrak OperatorStaking resmi (docs.zama.org/protocol/protocol-apps/addresses/mainnet/ethereum)
const OPERATOR_ZAMA: Record<string, string> = { 'Zama (KMS)': '0x8305d7c59886462B04C71Ecc5c5C331520C2a8E4', Dfns: '0xB9689c08A634B076849E61Ea4E42AB44aE2e5e2d', Figment: '0x8a3Bb2a9B28dAD4230a6dfE17124C398eA6416BF',
  Fireblocks: '0xF1BA887932d7559B3b00a58fE92F36CA8D7751d3', InfStones: '0x80c03b5be1417D18bAe68d5a1F0f2A97457b0C3c', Unit410: '0xFCAA267679B8364957560d7420E66Bb012013091', LayerZero: '0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF',
  Ledger: '0x78F597F1Dcf5dA536745558368c825654A1A044B', Omakase: '0xff54739b16576FA5402F211D0b938469Ab9A5f3F', 'Stake Capital': '0xFf021fB13cA64e5354c62c954b949a88cfDEb25E', OpenZeppelin: '0x75355a85c6FB9df5f0C80FF54e8747EEe9a0BF57',
  Etherscan: '0x93c931278A2aad1916783F952f94276eA5111442', Conduit: '0x50C271E25Ee953DD21E916311db81E228c9Bdb59', 'Zama (Coprocessor)': '0x5c9401fdA261fDb97188126e130e001DB38F1310', Blockscape: '0x126D6B697aD04228657Ba677c71CfE20A8745b03',
  P2P: '0xdB4FE5977d4f78f251C0F821C18C1F7A16Ad3A5e', Artifact: '0xf5A0f502C98Df9dC22A4E4f251eC3c75f2aD8098', Luganodes: '0xdD7fA0C796b3ca4fc1654F4eFFea5c4E9fF57a23' };
const GECKO: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', ZAMA: 'zama', INJ: 'injective-protocol', MON: 'monad', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', SOL: 'solana' };

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-region, x-kunci-pemilik', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const jawab = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });

// ---------- Bybit
async function tanda(teks: string) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(teks)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function bybit(jalur: string, q: Record<string, string>) { const qs = new URLSearchParams(q).toString(), ts = String(Date.now()), rw = '10000';
  const r = await fetch(`${BYBIT}${jalur}?${qs}`, { headers: { 'X-BAPI-API-KEY': KEY, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': rw, 'X-BAPI-SIGN': await tanda(ts + KEY + rw + qs) } });
  const j = await r.json(); if (j.retCode !== 0) throw new Error(`${jalur}: ${j.retCode} ${j.retMsg}`); return j.result; }
// ---------- EVM
async function rpc(url: string, method: string, params: unknown[]) { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 120)}`); return j.result as string; }
const panggil = (url: string, to: string, data: string) => rpc(url, 'eth_call', [{ to, data }, 'latest']);
const kata = (hex: string, i: number) => BigInt('0x' + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || '0'));
const angka = (b: bigint, d = 18) => Number(b) / 10 ** d, pad = (h: string) => h.padStart(64, '0'), alamat = pad(EVM.slice(2).toLowerCase());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  // pemeriksaan dari laptop pemilik memakai kunci server (cs_rahasia lantai_kunci), selain itu wajib akun Markasku pemilik
  const kunciUji = req.headers.get('x-kunci-pemilik'), kunciServer = kunciUji ? (await sb.from('cs_rahasia').select('nilai').eq('nama', 'lantai_kunci').maybeSingle()).data?.nilai : null;
  if (!(kunciUji && kunciServer && kunciUji === kunciServer)) { const { data: u } = await sb.auth.getUser(jwt); if (u?.user?.id !== PEMILIK) return jawab({ ok: false, pesan: 'Hanya pemilik.' }, 401); }

  const per: Record<string, { simbol: string; jumlah: number; akun: Record<string, number> }> = {}, galat: string[] = [], sumber: string[] = [];
  const tambah = (c: string, n: number, akun: string) => { if (!n || !isFinite(n)) return; const k = per[c] ??= { simbol: c, jumlah: 0, akun: {} }; k.jumlah += n; k.akun[akun] = (k.akun[akun] || 0) + n; };
  await Promise.all([
    // Bybit
    (async () => { if (!KEY || !SECRET) { galat.push('Kunci Bybit belum dipasang'); return; }
      try { const uni = await bybit('/v5/account/wallet-balance', { accountType: 'UNIFIED' }).catch(() => null);
        for (const a of uni?.list ?? []) for (const c of a.coin ?? []) tambah(c.coin, +c.walletBalance || 0, 'Bybit Unified');
        const dana = await bybit('/v5/asset/transfer/query-account-coins-balance', { accountType: 'FUND' }).catch(() => null);
        for (const c of dana?.balance ?? []) tambah(c.coin, +c.walletBalance || 0, 'Bybit Funding'); sumber.push('Bybit'); }
      catch (e) { galat.push('Bybit: ' + String((e as Error).message).slice(0, 100)); } })(),
    // Injective (Keplr)
    (async () => { try { const j = (p: string) => fetch(`${LCD_INJ}/${p}`).then(r => r.json());
        const [bal, del, rew, unb] = await Promise.all([j(`cosmos/bank/v1beta1/balances/${INJ}`), j(`cosmos/staking/v1beta1/delegations/${INJ}`), j(`cosmos/distribution/v1beta1/delegators/${INJ}/rewards`), j(`cosmos/staking/v1beta1/delegators/${INJ}/unbonding_delegations`)]);
        const inj = (x: string | undefined) => Number(String(x ?? '0').split('.')[0]) / 1e18;
        tambah('INJ', inj(bal.balances?.find((b: any) => b.denom === 'inj')?.amount), 'Keplr wallet');
        tambah('INJ', (del.delegation_responses ?? []).reduce((a: number, d: any) => a + inj(d.balance?.amount), 0), 'Keplr staking');
        tambah('INJ', inj(rew.total?.find((t: any) => t.denom === 'inj')?.amount), 'Keplr hadiah staking');
        tambah('INJ', (unb.unbonding_responses ?? []).flatMap((u: any) => u.entries ?? []).reduce((a: number, e: any) => a + inj(e.balance), 0), 'Keplr sedang unstake'); sumber.push('Injective'); }
      catch (e) { galat.push('Injective: ' + String((e as Error).message).slice(0, 100)); } })(),
    // Monad (MetaMask)
    (async () => { try { const P = '0x0000000000000000000000000000000000001000';
        tambah('MON', angka(BigInt(await rpc(RPC_MON, 'eth_getBalance', [EVM, 'latest']))), 'MetaMask wallet');
        let mulai = 0n; const val: bigint[] = [];
        for (let i = 0; i < 10; i++) { const d = await panggil(RPC_MON, P, '0x4fd66050' + alamat + pad(mulai.toString(16))); const n = Number(kata(d, 3));
          for (let k = 0; k < n; k++) val.push(kata(d, 4 + k)); if (kata(d, 0) === 1n) break; mulai = kata(d, 1); }
        for (const v of val) { const g = await panggil(RPC_MON, P, '0x573c1ce0' + pad(v.toString(16)) + alamat);
          tambah('MON', angka(kata(g, 0)) + angka(kata(g, 3)) + angka(kata(g, 4)), 'MetaMask staking'); tambah('MON', angka(kata(g, 2)), 'MetaMask hadiah staking');
          // 16 Okt 2026, pemilik: "zama dan mon lagi di unstake dan menunggu proses penarikan". MON yang sudah di-unstake
          // menunggu epoch di permintaan penarikan (getWithdrawalRequest, id 0-7); tetap aset pemilik sampai di-Withdraw.
          const tarik = await Promise.all([...Array(8).keys()].map(id => panggil(RPC_MON, P, '0x56fa2045' + pad(v.toString(16)) + alamat + pad(id.toString(16))).catch(() => '0x')));
          tambah('MON', tarik.reduce((a, t) => a + angka(kata(t, 0)), 0), 'MetaMask sedang ditarik'); }
        sumber.push('Monad'); }
      catch (e) { galat.push('Monad: ' + String((e as Error).message).slice(0, 100)); } })(),
    // Ethereum (MetaMask): ZAMA di wallet + staking resmi Zama
    (async () => { try { tambah('ZAMA', angka(kata(await panggil(RPC_ETH, ZAMA, '0x70a08231' + alamat), 0)), 'MetaMask wallet');
        await Promise.all(Object.entries(OPERATOR_ZAMA).map(async ([nama, c]) => { const s = kata(await panggil(RPC_ETH, c, '0x70a08231' + alamat), 0); if (s === 0n) return;
          tambah('ZAMA', angka(kata(await panggil(RPC_ETH, c, '0x4cdad506' + pad(s.toString(16))), 0)), `staking Zama (${nama})`); }));
        sumber.push('Ethereum'); }
      catch (e) { galat.push('Ethereum: ' + String((e as Error).message).slice(0, 100)); } })(),
  ]);

  // harga: CoinGecko dalam Rupiah dan dolar; koin tanpa id CoinGecko memakai ticker spot Bybit x kurs USDT
  const ids = [...new Set(['tether', ...Object.keys(per).map(s => GECKO[s]).filter(Boolean)])];
  const h = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd,idr`).then(r => r.json()).catch(() => ({}));
  const kurs = +(h?.tether?.idr ?? 0) / (+(h?.tether?.usd ?? 1) || 1);
  const koin = await Promise.all(Object.values(per).map(async k => { const g = h?.[GECKO[k.simbol]];
    let usd = +(g?.usd ?? 0), idr = +(g?.idr ?? 0);
    if (!usd) { const t = await fetch(`${BYBIT}/v5/market/tickers?category=spot&symbol=${k.simbol}USDT`).then(r => r.json()).catch(() => null); usd = +(t?.result?.list?.[0]?.lastPrice ?? 0); idr = usd * kurs; }
    return { ...k, hargaUsd: usd, hargaIdr: idr, nilaiUsd: k.jumlah * usd, nilaiIdr: k.jumlah * idr }; }));
  koin.sort((a, b) => b.nilaiIdr - a.nilaiIdr);
  // Sinkron ke Markasku (pemilik 13 Okt 2026: "yang terlihat di Markasku itu data lama makanya di-update"): nilai aset
  // crypto di dokumen keuangan/aset diganti saldo sungguhan. Kas (dari arus kas), aset lain, dan utang tidak disentuh.
  let sinkron: unknown = null; const badan = await req.json().catch(() => ({}));
  if (badan.sinkron && koin.length && !galat.some(x => !x.startsWith('Kunci Bybit'))) {
    const { data: dok } = await sb.from('markas_dokumen').select('data').eq('user_id', PEMILIK).eq('path', 'keuangan/aset').maybeSingle();
    if (dok?.data?.aset) { const d = dok.data, peta = Object.fromEntries(koin.map(k => [k.simbol, k])), diubah: string[] = [];
      for (const a of d.aset) { const k = peta[String(a.nama || '').trim().toUpperCase()]; if (!k || !(k.hargaIdr > 0) || a.kas || !['Bitcoin', 'Altcoin', 'Stablecoin', 'Crypto'].includes(a.kategori)) continue;
        const baru = Math.round(k.nilaiIdr); if (Math.abs(baru - (+a.nilai || 0)) >= 1) { diubah.push(`${a.nama} ${a.nilai} -> ${baru}`); a.nilai = baru; }
        a.jumlahKoin = +k.jumlah.toFixed(8); a.sumberLive = Object.keys(k.akun).join(', '); a.diperbaruiLive = new Date().toISOString(); }
      if (diubah.length) { d.diperbarui = new Date().toISOString(); await sb.from('markas_dokumen').update({ data: d, diperbarui: d.diperbarui }).eq('user_id', PEMILIK).eq('path', 'keuangan/aset'); }
      sinkron = { diubah }; } }
  return jawab({ sinkron, ok: true, siap: koin.length > 0, sumber: sumber.join(', '), galat, koin, totalUsd: koin.reduce((a, k) => a + k.nilaiUsd, 0), totalIdr: koin.reduce((a, k) => a + k.nilaiIdr, 0), kurs, waktu: new Date().toISOString() });
});
