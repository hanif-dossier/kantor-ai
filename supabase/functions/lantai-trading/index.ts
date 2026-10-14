// Lantai Trading (13 Okt 2026): mesin 8 robot Binance USDT-M futures. Dipanggil pg_cron tiap 5 menit (lantai__tick,
// header x-region ap-south-1 dan x-lantai-kunci). Aturan tiap robot ditulis sebelum robot berjalan:
//   - satu robot satu strategi, memindai 40 pair USDT perpetual paling ramai dan memilih sinyal terkuat; satu posisi per robot,
//     satu pair satu robot; delapan robot berbagi SATU dompet (lantai_dompet, $100),
//     paling banyak 3 posisi terbuka bersamaan;
//   - ukuran posisi: rugi kalau stop loss kena = 3% x tingkat ($3 selama saldo di bawah $300; tingkat naik 3x tiap saldo
//     menyentuh 3x tingkat: $300 -> $9, $900 -> $27 ...); leverage dihitung per transaksi, likuidasi selalu di luar stop loss;
//   - stop loss selalu dipasang; take profit kalau strateginya punya;
//   - rem darurat: saldo turun rem_persen (bawaan 40%, diatur pemilik) dari PUNCAK saldo -> semua posisi ditutup, semua
//     robot berhenti sampai pemilik menyalakan lagi;
//   - robot yang rugi bersihnya sendiri mencapai 15% tingkat DIKELUARKAN sampai pemilik memulai ulang.
// SIMULASI (bawaan): harga sungguhan, isian di harga mark + selip 0,02%, biaya taker 0,05% per sisi, funding diabaikan.
// UANG SUNGGUHAN hanya kalau robot.live = true (dinyalakan pemilik di lantai.html) DAN secret BINANCE_KEY + BINANCE_SECRET
// ada (dipasang pemilik sendiri). Satu koin hanya boleh dipegang satu robot live (mode one-way Binance).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const FAPI = Deno.env.get('BINANCE_TESTNET') === '1' ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
const KEY = Deno.env.get('BINANCE_KEY') ?? '', SECRET = Deno.env.get('BINANCE_SECRET') ?? '';
const BIAYA = 0.0005, SELIP = 0.0002;
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// ---------- data pasar
type Lilin = { t: number; o: number; h: number; l: number; c: number; v: number };
async function ambil(url: string) { const r = await fetch(url); if (!r.ok) throw new Error(`${url.split('?')[0].split('/').pop()}: ${r.status} ${(await r.text()).slice(0, 120)}`); return r.json(); }
async function lilin(simbol: string, iv: string): Promise<Lilin[]> {
  const a = await ambil(`${FAPI}/fapi/v1/klines?symbol=${simbol}&interval=${iv}&limit=300`), kini = Date.now();
  return a.filter((k: any[]) => k[6] < kini).map((k: any[]) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));   // hanya lilin yang sudah tutup
}

// ---------- indikator
const ema = (x: number[], n: number) => { const k = 2 / (n + 1), o: number[] = []; x.forEach((v, i) => o.push(i ? v * k + o[i - 1] * (1 - k) : v)); return o; };
const sma = (x: number[], n: number) => x.map((_, i) => i < n - 1 ? NaN : x.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);
function rsi(c: number[], n = 14) { const o = Array(c.length).fill(NaN); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = 100 - 100 / (1 + g / (l || 1e-12)); } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = 100 - 100 / (1 + g / (l || 1e-12)); } }
  return o; }
function atr(k: Lilin[], n = 14) { const tr = k.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - k[i - 1].c), Math.abs(x.l - k[i - 1].c)) : x.h - x.l); const o: number[] = [];
  tr.forEach((v, i) => o.push(i < n ? tr.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) : (o[i - 1] * (n - 1) + v) / n)); return o; }
function supertrend(k: Lilin[], n = 10, m = 3) { const a = atr(k, n), garis: number[] = [], arah: number[] = []; let atas = 0, bawah = 0;
  k.forEach((x, i) => { const tengah = (x.h + x.l) / 2, ua = tengah + m * a[i], ub = tengah - m * a[i];
    atas = i && (ua < atas || k[i - 1].c > atas) ? ua : i ? atas : ua; bawah = i && (ub > bawah || k[i - 1].c < bawah) ? ub : i ? bawah : ub;
    const d = !i ? 1 : arah[i - 1] === 1 ? (x.c < bawah ? -1 : 1) : (x.c > atas ? 1 : -1); arah.push(d); garis.push(d === 1 ? bawah : atas); });
  return { garis, arah }; }

// ---------- strategi: masuk() dinilai pada lilin terakhir yang tutup; keluar() untuk posisi terbuka
type Sinyal = { sisi: 'long' | 'short'; sl: number; tp: number | null; alasan: string; kuat?: number } | null;   // kuat: untuk memilih sinyal terbaik antar-pair
// semesta pair yang dipindai: USDT perpetual paling ramai (nilai transaksi 24 jam), tanpa pasangan stablecoin
const SEMESTA_N = 40, SEMESTA_VOL_MIN = 50e6, STABIL = /^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|EUR|AEUR|USDE|BFUSD|XUSD|RLUSD|USD1)USDT$/;
const IV_MS: Record<string, number> = { '15m': 9e5, '1h': 36e5, '4h': 144e5 };
const UJI_KOIN = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT'];
// Pair per strategi (13 Okt 2026, pemilik: "random ya bisa btc juga altcoin besar tetapi sesuaikan juga dengan strategi
// masing2"). 'besar' = BTC + altcoin besar (tren, momentum, pantulan butuh pasar likuid yang rapi); 'luas' = altcoin besar +
// pair paling ramai hari ini (breakout, lonjakan volume, funding ekstrem sering terjadi di koin yang sedang ramai);
// 'paus' = koin yang sedang dibuka trader top Hyperliquid. Dari sinyal yang ada, pilihan diundi berbobot kekuatan sinyal.
const BESAR = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TRX', 'DOT', 'LTC', 'BCH', 'NEAR', 'SUI', 'APT', 'ARB', 'OP', 'INJ', 'UNI', 'AAVE', 'ATOM',
  'HBAR', 'XLM', 'FIL', 'ETC', 'TAO', 'HYPE', 'ENA', 'WLD', 'SEI', 'TIA', 'ONDO', '1000PEPE', '1000SHIB', 'RENDER', 'FET', 'TON', 'ICP'].map(x => x + 'USDT');
const KUMPULAN: Record<string, 'besar' | 'luas' | 'paus'> = { 'ikut-tren': 'besar', 'momentum-macd': 'besar', 'supertrend': 'besar', 'pantulan-rsi': 'besar', 'kembali-ke-tengah': 'besar',
  'tembus-kisaran': 'luas', 'lonjakan-volume': 'luas', 'lawan-funding': 'luas', 'ikut-paus': 'paus' };
const BESAR_VOL_MIN = 20e6;
const HL_INFO = 'https://api.hyperliquid.xyz/info', HL_PAPAN = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard', PAUS_N = 30, PAUS_BARU_MS = 36e5;
const hlKeBinance = (c: string) => (/^k[A-Z]/.test(c) ? '1000' + c.slice(1) : c) + 'USDT';   // kPEPE -> 1000PEPEUSDT
const undiBerbobot = <T extends { s: any }>(xs: T[]) => xs.map(x => ({ x, kunci: Math.pow(Math.random(), 1 / Math.max(.1, x.s.kuat ?? 1)) })).sort((a, b) => b.kunci - a.kunci).map(o => o.x);
type Paus = { long: number; short: number; baruLong: number; baruShort: number };
type Ctx = { k: Lilin[]; funding?: number; paus?: Paus };
// Aturan pemilik (13 Okt 2026): risk:reward paling rendah 1:2, lebih banyak 1:3. Setiap strategi punya `rr`; take profit
// TIDAK diambil dari sinyal tetapi dihitung mesin dari harga masuk sebenarnya: masuk +/- rr x jarak stop loss.
const RR_MIN = 2;
const STRATEGI: Record<string, { judul: string; aturan: string; rr: number; masuk: (x: Ctx) => Sinyal; keluar?: (x: Ctx, sisi: string) => string | null; maksLilin?: number; jejak?: (x: Ctx, sisi: string) => number | null }> = {
  'ikut-tren': { judul: 'Ikut tren', rr: 3, aturan: 'EMA 20 memotong EMA 50: ke atas long, ke bawah short. Stop loss 2 ATR, take profit 3x jarak stop loss (1:3), keluar lebih awal kalau potongan EMA berbalik.',
    masuk: ({ k }) => { const c = k.map(x => x.c), a = ema(c, 20), b = ema(c, 50), t = atr(k), i = c.length - 1;
      if (a[i] > b[i] && a[i - 1] <= b[i - 1]) return { sisi: 'long', sl: c[i] - 2 * t[i], tp: c[i] + 4 * t[i], alasan: 'EMA 20 memotong EMA 50 ke atas' };
      if (a[i] < b[i] && a[i - 1] >= b[i - 1]) return { sisi: 'short', sl: c[i] + 2 * t[i], tp: c[i] - 4 * t[i], alasan: 'EMA 20 memotong EMA 50 ke bawah' }; return null; },
    keluar: ({ k }, s) => { const c = k.map(x => x.c), a = ema(c, 20), b = ema(c, 50), i = c.length - 1; return (s === 'long' ? a[i] < b[i] : a[i] > b[i]) ? 'tren berbalik' : null; } },
  'tembus-kisaran': { judul: 'Tembus kisaran', rr: 3, aturan: 'Harga tutup di atas tertinggi 20 lilin: long; di bawah terendah 20 lilin: short. Stop loss 1,5 ATR, take profit 3x jarak stop loss (1:3), keluar lebih awal kalau tembus balik kisaran 10 lilin.',
    masuk: ({ k }) => { const i = k.length - 1, s = k.slice(i - 20, i), hh = Math.max(...s.map(x => x.h)), ll = Math.min(...s.map(x => x.l)), t = atr(k)[i], c = k[i].c;
      if (c > hh) return { sisi: 'long', sl: c - 1.5 * t, tp: null, alasan: 'tutup di atas tertinggi 20 lilin' }; if (c < ll) return { sisi: 'short', sl: c + 1.5 * t, tp: null, alasan: 'tutup di bawah terendah 20 lilin' }; return null; },
    keluar: ({ k }, s) => { const i = k.length - 1, w = k.slice(i - 10, i); return s === 'long' ? (k[i].c < Math.min(...w.map(x => x.l)) ? 'tembus balik ke bawah kisaran 10 lilin' : null) : (k[i].c > Math.max(...w.map(x => x.h)) ? 'tembus balik ke atas kisaran 10 lilin' : null); } },
  'pantulan-rsi': { judul: 'Pantulan RSI', rr: 2, aturan: 'RSI 14 naik dari bawah 35 dan harga di atas EMA 200: long; turun dari atas 65 dan harga di bawah EMA 200: short. Stop loss 1,5 ATR, take profit 2x jarak stop loss (1:2).',
    masuk: ({ k }) => { const c = k.map(x => x.c), r = rsi(c), e = ema(c, 200), t = atr(k), i = c.length - 1;
      if (r[i - 1] < 35 && r[i] >= 35 && c[i] > e[i]) return { sisi: 'long', sl: c[i] - 1.5 * t[i], tp: c[i] + 2 * t[i], alasan: `RSI naik dari ${r[i - 1].toFixed(0)} ke ${r[i].toFixed(0)}, harga di atas EMA 200` };
      if (r[i - 1] > 65 && r[i] <= 65 && c[i] < e[i]) return { sisi: 'short', sl: c[i] + 1.5 * t[i], tp: c[i] - 2 * t[i], alasan: `RSI turun dari ${r[i - 1].toFixed(0)} ke ${r[i].toFixed(0)}, harga di bawah EMA 200` }; return null; },
  },
  'kembali-ke-tengah': { judul: 'Kembali ke tengah', rr: 2, aturan: 'Harga tutup di luar pita Bollinger (20, 2): di bawah pita long, di atas pita short. Stop loss 1,5 ATR, take profit 2x jarak stop loss (1:2), paling lama 48 lilin (12 jam).',
    masuk: ({ k }) => { const c = k.map(x => x.c), m = sma(c, 20), i = c.length - 1, sd = Math.sqrt(c.slice(i - 19).reduce((a, x) => a + (x - m[i]) ** 2, 0) / 20), t = atr(k)[i];
      if (c[i] < m[i] - 2 * sd) return { sisi: 'long', sl: c[i] - 1.5 * t, tp: m[i], alasan: 'tutup di bawah pita bawah Bollinger' };
      if (c[i] > m[i] + 2 * sd) return { sisi: 'short', sl: c[i] + 1.5 * t, tp: m[i], alasan: 'tutup di atas pita atas Bollinger' }; return null; },
    maksLilin: 48 },
  'momentum-macd': { judul: 'Momentum MACD', rr: 3, aturan: 'Garis MACD (12, 26) memotong sinyal (9) searah posisi nol: di atas nol long, di bawah nol short. Stop loss 2 ATR, take profit 3x jarak stop loss (1:3), paling lama 48 lilin (2 hari).',
    masuk: ({ k }) => { const c = k.map(x => x.c), a = ema(c, 12), b = ema(c, 26), m = a.map((x, i) => x - b[i]), s = ema(m, 9), t = atr(k), i = c.length - 1;
      if (m[i] > s[i] && m[i - 1] <= s[i - 1] && m[i] > 0) return { sisi: 'long', sl: c[i] - 2 * t[i], tp: c[i] + 3 * t[i], alasan: 'MACD memotong sinyal ke atas di atas nol' };
      if (m[i] < s[i] && m[i - 1] >= s[i - 1] && m[i] < 0) return { sisi: 'short', sl: c[i] + 2 * t[i], tp: c[i] - 3 * t[i], alasan: 'MACD memotong sinyal ke bawah di bawah nol' }; return null; },
    maksLilin: 48 },
  'lonjakan-volume': { judul: 'Lonjakan volume', rr: 3, aturan: 'Volume lebih dari 3 kali rata-rata 20 lilin dan badan lilin lebih dari 60% rentangnya: ikut arah lilin. Stop loss 1 ATR, take profit 3x jarak stop loss (1:3), paling lama 16 lilin (4 jam).',
    masuk: ({ k }) => { const i = k.length - 1, x = k[i], rata = k.slice(i - 20, i).reduce((a, y) => a + y.v, 0) / 20, t = atr(k)[i], badan = Math.abs(x.c - x.o), rentang = x.h - x.l || 1e-12;
      if (x.v > 3 * rata && badan > .6 * rentang) return x.c > x.o ? { sisi: 'long', sl: x.c - t, tp: x.c + 2 * t, kuat: x.v / rata, alasan: `volume ${(x.v / rata).toFixed(1)}x rata-rata, lilin naik` } : { sisi: 'short', sl: x.c + t, tp: x.c - 2 * t, kuat: x.v / rata, alasan: `volume ${(x.v / rata).toFixed(1)}x rata-rata, lilin turun` };
      return null; }, maksLilin: 16 },
  'lawan-funding': { judul: 'Lawan funding', rr: 2, aturan: 'Funding rate di atas 0,03% (terlalu banyak long): short; di bawah -0,01% (terlalu banyak short): long. Stop loss 1,5 ATR, take profit 2x jarak stop loss (1:2), paling lama 16 jam.',
    masuk: ({ k, funding }) => { if (funding == null) return null; const i = k.length - 1, t = atr(k)[i], c = k[i].c;
      if (funding > .0003) return { sisi: 'short', sl: c + 1.5 * t, tp: c - 2 * t, kuat: Math.abs(funding) * 1e4, alasan: `funding ${(funding * 100).toFixed(3)}%, pasar terlalu condong long` };
      if (funding < -.0001) return { sisi: 'long', sl: c - 1.5 * t, tp: c + 2 * t, kuat: Math.abs(funding) * 1e4, alasan: `funding ${(funding * 100).toFixed(3)}%, pasar terlalu condong short` }; return null; },
    maksLilin: 16 },
  'ikut-paus': { judul: 'Pengintai Hyperliquid', rr: 3, aturan: 'Memantau 30 trader paling untung di Hyperliquid (nilai akun minimal $100 rb, untung bulan ini dan sepanjang masa, aktif trading tapi bukan bot market maker). Masuk kalau minimal 2 dari mereka baru membuka posisi searah di koin yang sama dalam 1 jam terakhir dan yang searah lebih banyak minimal 3 orang dari yang berlawanan. Stop loss 3 ATR lilin 15 menit, take profit 3x jarak stop loss (1:3), keluar lebih awal kalau mereka sudah tidak condong ke arah posisi.',
    masuk: ({ k, paus }) => { if (!paus) return null; const i = k.length - 1, t = atr(k)[i], c = k[i].c, net = paus.long - paus.short;
      if (paus.baruLong >= 2 && net >= 3) return { sisi: 'long', sl: c - 3 * t, tp: null, kuat: net + paus.baruLong, alasan: `${paus.baruLong} trader top Hyperliquid baru buka long (${paus.long} long vs ${paus.short} short)` };
      if (paus.baruShort >= 2 && -net >= 3) return { sisi: 'short', sl: c + 3 * t, tp: null, kuat: -net + paus.baruShort, alasan: `${paus.baruShort} trader top Hyperliquid baru buka short (${paus.short} short vs ${paus.long} long)` }; return null; },
    keluar: ({ paus }, s) => { if (!paus) return null; const net = paus.long - paus.short; return (s === 'long' ? net < 1 : net > -1) ? 'trader top Hyperliquid sudah tidak condong ke arah ini' : null; } },
  'supertrend': { judul: 'Supertrend', rr: 3, aturan: 'Supertrend (10, 3) berbalik arah: ikut arah baru. Stop loss di garis supertrend dan ikut bergeser mengunci untung, take profit 3x jarak stop loss awal (1:3), keluar kalau supertrend berbalik lagi.',
    masuk: ({ k }) => { const { garis, arah } = supertrend(k), i = k.length - 1;
      if (arah[i] === 1 && arah[i - 1] === -1) return { sisi: 'long', sl: garis[i], tp: null, alasan: 'supertrend berbalik naik' };
      if (arah[i] === -1 && arah[i - 1] === 1) return { sisi: 'short', sl: garis[i], tp: null, alasan: 'supertrend berbalik turun' }; return null; },
    keluar: ({ k }, s) => { const { arah } = supertrend(k), i = k.length - 1; return (s === 'long' ? arah[i] === -1 : arah[i] === 1) ? 'supertrend berbalik' : null; },
    jejak: ({ k }) => supertrend(k).garis[k.length - 1] },
};

// ---------- Binance bertanda tangan (hanya untuk robot live)
type Akun = { base: string; key: string; secret: string };
const AKUN_LIVE: Akun = { base: FAPI, key: KEY, secret: SECRET };
// Binance Demo Trading (uang mainan, kunci dipasang pemilik). Kalau lantai_dompet.akun = 'demo', robot yang tidak live
// mengirim order sungguhan ke akun demo supaya pemilik bisa melihat posisinya di demo.binance.com.
const AKUN_DEMO: Akun = { base: Deno.env.get('BINANCE_TESTNET_URL') ?? 'https://demo-fapi.binance.com', key: Deno.env.get('BINANCE_TESTNET_KEY') ?? '', secret: Deno.env.get('BINANCE_TESTNET_SECRET') ?? '' };
const AKUN: Record<string, Akun> = { live: AKUN_LIVE, demo: AKUN_DEMO };
const akunPos = (p: any): string | null => p ? (p.akun ?? (p.live ? 'live' : null)) : null;
async function tanda(q: string, rahasia = SECRET) { const kunci = await crypto.subtle.importKey('raw', new TextEncoder().encode(rahasia), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', kunci, new TextEncoder().encode(q)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function bursa(metode: string, jalur: string, p: Record<string, string | number | boolean> = {}, akun: Akun = AKUN_LIVE) {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(p).map(([a, b]) => [a, String(b)])), recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  const r = await fetch(`${akun.base}${jalur}?${q}&signature=${await tanda(q, akun.secret)}`, { method: metode, headers: { 'X-MBX-APIKEY': akun.key } }); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${jalur}: ${j.code ?? r.status} ${j.msg ?? ''}`); return j; }
// Stop loss / take profit di bursa. Binance memindahkan order bersyarat (STOP_MARKET, TAKE_PROFIT_MARKET) ke Algo Order API;
// coba endpoint order biasa dulu, kalau ditolak pakai /fapi/v1/algoOrder. Dipakai jalur live DAN uji testnet.
async function pasangPengaman(akun: Akun, simbol: string, sisi: string, sl: number, tp: number | null, tik: number) {
  const lawan = sisi === 'long' ? 'SELL' : 'BUY', d = Math.max(0, -Math.floor(Math.log10(tik))), h = (v: number) => (Math.floor(v / tik + 1e-9) * tik).toFixed(d), hasil: string[] = [];
  for (const [jenis, harga] of [['STOP_MARKET', sl], ['TAKE_PROFIT_MARKET', tp]] as [string, number | null][]) { if (harga == null) continue;
    try { await bursa('POST', '/fapi/v1/order', { symbol: simbol, side: lawan, type: jenis, stopPrice: h(harga), closePosition: true, workingType: 'MARK_PRICE' }, akun); hasil.push(`${jenis} lewat order biasa`); }
    catch (e1) { await bursa('POST', '/fapi/v1/algoOrder', { algoType: 'CONDITIONAL', symbol: simbol, side: lawan, type: jenis, triggerPrice: h(harga), closePosition: true, workingType: 'MARK_PRICE' }, akun)
      .then(() => hasil.push(`${jenis} lewat algo order (order biasa ditolak: ${String((e1 as Error).message).slice(0, 80)})`)); } }
  return hasil; }
async function batalSemua(akun: Akun, simbol: string) {
  await bursa('DELETE', '/fapi/v1/allOpenOrders', { symbol: simbol }, akun).catch(() => null);
  await bursa('DELETE', '/fapi/v1/algoOpenOrders', { symbol: simbol }, akun).catch(() => null); }

// ---------- uji jalur live di Binance Testnet (uang mainan): satu siklus penuh, tiap langkah dilaporkan
async function ujiTestnet(simbol: string) {
  // Testnet futures lama diganti Binance Demo Trading (Okt 2026): kunci dibuat di demo.binance.com, API di demo-fapi.binance.com
  const TN: Akun = { base: Deno.env.get('BINANCE_TESTNET_URL') ?? 'https://demo-fapi.binance.com', key: Deno.env.get('BINANCE_TESTNET_KEY') ?? '', secret: Deno.env.get('BINANCE_TESTNET_SECRET') ?? '' };
  if (!TN.key || !TN.secret) return { ok: false, pesan: 'Secret BINANCE_TESTNET_KEY dan BINANCE_TESTNET_SECRET belum dipasang.' };
  const langkah: { langkah: string; ok: boolean; isi: string }[] = [], catat = (l: string, ok: boolean, isi: string) => langkah.push({ langkah: l, ok, isi: String(isi).slice(0, 220) });
  const B = (m: string, j: string, p: Record<string, string | number | boolean> = {}) => bursa(m, j, p, TN);
  try {
    const bal = await B('GET', '/fapi/v2/balance'); catat('baca saldo', true, 'USDT tersedia ' + (bal.find((b: any) => b.asset === 'USDT')?.availableBalance ?? '?'));
    const info = await ambil(`${TN.base}/fapi/v1/exchangeInfo`), s = info.symbols.find((x: any) => x.symbol === simbol), f = Object.fromEntries(s.filters.map((x: any) => [x.filterType, x]));
    const langkahQ = +f.LOT_SIZE.stepSize, tik = +f.PRICE_FILTER.tickSize, minNilai = +(f.MIN_NOTIONAL?.notional ?? 5), dq = Math.max(0, -Math.floor(Math.log10(langkahQ)));
    const mark = +(await ambil(`${TN.base}/fapi/v1/premiumIndex?symbol=${simbol}`)).markPrice;
    await B('POST', '/fapi/v1/marginType', { symbol: simbol, marginType: 'ISOLATED' }).then(() => catat('margin isolated', true, 'diubah ke isolated')).catch(e => catat('margin isolated', /4046|No need/i.test(e.message), e.message));
    await B('POST', '/fapi/v1/leverage', { symbol: simbol, leverage: 3 }).then(j => catat('leverage', true, `${j.leverage}x`));
    const qty = Math.ceil(minNilai * 1.15 / mark / langkahQ) * langkahQ;
    const o = await B('POST', '/fapi/v1/order', { symbol: simbol, side: 'BUY', type: 'MARKET', quantity: qty.toFixed(dq), newOrderRespType: 'RESULT' }); const masuk = +o.avgPrice || mark;
    catat('buka long MARKET', o.status === 'FILLED', `${qty.toFixed(dq)} ${simbol} di ${masuk} (status ${o.status})`);
    const p = await pasangPengaman(TN, simbol, 'long', masuk * .97, masuk * 1.04, tik); catat('pasang stop loss + take profit', p.length === 2, p.join('; '));
    const biasa = await B('GET', '/fapi/v1/openOrders', { symbol: simbol }).catch(() => []), algo = await B('GET', '/fapi/v1/openAlgoOrders', { symbol: simbol }).catch(() => []);
    const nAlgo = Array.isArray(algo) ? algo.length : (algo.orders?.length ?? 0);
    catat('order pengaman terpasang di bursa', biasa.length + nAlgo >= 2, `order biasa ${biasa.length}, algo ${nAlgo}`);
    const pr = (await B('GET', '/fapi/v2/positionRisk', { symbol: simbol }))[0]; catat('posisi tercatat', +pr.positionAmt > 0, `jumlah ${pr.positionAmt}, margin ${pr.marginType}, leverage ${pr.leverage}`);
    await batalSemua(TN, simbol);
    const t = await B('POST', '/fapi/v1/order', { symbol: simbol, side: 'SELL', type: 'MARKET', quantity: qty.toFixed(dq), reduceOnly: true, newOrderRespType: 'RESULT' }); catat('tutup posisi', t.status === 'FILLED', `di ${t.avgPrice}`);
    const akhir = (await B('GET', '/fapi/v2/positionRisk', { symbol: simbol }))[0], sisa = await B('GET', '/fapi/v1/openOrders', { symbol: simbol }).catch(() => []);
    const sisaAlgo = await B('GET', '/fapi/v1/openAlgoOrders', { symbol: simbol }).catch(() => []), nSisaAlgo = Array.isArray(sisaAlgo) ? sisaAlgo.length : (sisaAlgo.orders?.length ?? 0);
    catat('bersih: tanpa posisi dan order', +akhir.positionAmt === 0 && sisa.length === 0 && nSisaAlgo === 0, `posisi ${akhir.positionAmt}, order tersisa ${sisa.length}, algo tersisa ${nSisaAlgo}`);
  } catch (e) { catat('GAGAL', false, String((e as Error).message)); await batalSemua(TN, simbol).catch(() => null); }
  return { ok: langkah.every(x => x.ok), langkah }; }

// ---------- uji mundur: aturan yang sama pada lilin lampau, tanpa menulis apa pun (body {"uji": true})
async function ujiMundur(r: any, A: { langkah: number; minNilai: number }) {
  const S = STRATEGI[r.strategi], raw = await ambil(`${FAPI}/fapi/v1/klines?symbol=${r.simbol}&interval=${r.interval}&limit=1000`), kini = Date.now();
  const K: Lilin[] = raw.filter((x: any[]) => x[6] < kini).map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
  const fr = r.strategi === 'lawan-funding' ? (await ambil(`${FAPI}/fapi/v1/fundingRate?symbol=${r.simbol}&limit=1000`)).map((x: any) => [+x.fundingTime, +x.fundingRate]) : [];
  const AWAL = 100, RISIKO = 3, BATAS = 15; let kas = AWAL, pos: any = null, puncak = kas, dd = 0, n = 0, menang = 0, dilewati = 0; const daftar: string[] = [];
  const tutup = (harga: number, alasan: string, t: number) => { const keluar = harga * (pos.sisi === 'long' ? 1 - SELIP : 1 + SELIP), arah = pos.sisi === 'long' ? 1 : -1;
    const bersih = (keluar - pos.masuk) * pos.qty * arah - (pos.masuk + keluar) * pos.qty * BIAYA; kas += bersih; n++; if (bersih > 0) menang++;
    if (daftar.length < 6) daftar.push(`${new Date(pos.t).toISOString().slice(5, 16)} ${pos.sisi} ${bersih >= 0 ? '+' : ''}${bersih.toFixed(2)} ${alasan}`); pos = null; };
  for (let i = 210; i < K.length; i++) { const k = K.slice(Math.max(0, i - 299), i + 1), x = K[i], ctx: Ctx = { k, funding: fr.filter((f: number[]) => f[0] <= x.t).at(-1)?.[1] };
    if (pos) { const kenaSl = pos.sisi === 'long' ? x.l <= pos.sl : x.h >= pos.sl, kenaTp = pos.tp != null && (pos.sisi === 'long' ? x.h >= pos.tp : x.l <= pos.tp);
      if (kenaSl) tutup(pos.sl, 'SL', x.t); else if (kenaTp) tutup(pos.tp, 'TP', x.t);
      if (pos && S.jejak) { const g = S.jejak(ctx, pos.sisi); if (g != null && (pos.sisi === 'long' ? g > pos.sl : g < pos.sl)) pos.sl = g; }
      if (pos && S.keluar) { const a = S.keluar(ctx, pos.sisi); if (a) tutup(x.c, a, x.t); }
      if (pos && S.maksLilin && i - pos.i >= S.maksLilin) tutup(x.c, 'batas lama', x.t); }
    const modal = kas + (pos ? (x.c - pos.masuk) * pos.qty * (pos.sisi === 'long' ? 1 : -1) : 0); puncak = Math.max(puncak, modal); dd = Math.max(dd, (puncak - modal) / puncak);
    if (modal <= AWAL - BATAS) { if (pos) tutup(x.c, 'batas rugi', x.t); daftar.push('DIKELUARKAN di ' + new Date(x.t).toISOString().slice(5, 16)); break; }
    if (!pos) { const s = S.masuk(ctx); if (s) { const harga = x.c * (s.sisi === 'long' ? 1 + SELIP : 1 - SELIP), jarak = Math.abs(harga - s.sl);
      let qty = Math.min(jarak > 0 ? RISIKO / (jarak + (harga + s.sl) * BIAYA + s.sl * SELIP) : 0, Math.min(20, Math.floor(.8 / (jarak / harga))) * (kas / 3) / harga); qty = Math.floor(qty / A.langkah + 1e-9) * A.langkah;
      if (qty * harga < A.minNilai || (s.sisi === 'long' ? s.sl >= harga : s.sl <= harga)) dilewati++; else pos = { ...s, tp: harga + (s.sisi === 'long' ? 1 : -1) * Math.max(RR_MIN, S.rr) * jarak, masuk: harga, qty, i, t: x.t }; } } }
  return { robot: r.nama, simbol: r.simbol, interval: r.interval, dari: new Date(K[210].t).toISOString().slice(0, 10), sampai: new Date(K.at(-1)!.t).toISOString().slice(0, 10),
    transaksi: n, menang, kas: +kas.toFixed(2), hasil: +((kas / AWAL - 1) * 100).toFixed(1) + '%', ddMaks: +(dd * 100).toFixed(1) + '%', dilewati, contoh: daftar }; }

// ---------- Hyperliquid
// Papan peringkat 39 MB dibaca bertahap (baris demi baris) supaya memori fungsi tidak habis, lalu dipilih 30 trader.
async function segarPaus() {
  const r = await fetch(HL_PAPAN); if (!r.ok || !r.body) throw new Error('papan Hyperliquid ' + r.status);
  const baca = r.body.pipeThrough(new TextDecoderStream()).getReader(), calon: any[] = []; let buf = '', n = 0;
  // berkasnya JSON berindentasi: potong per penanda "ethAddress", buang penutup/pembuka di ekor, tutup lagi dengan '}'
  const proses = (t: string) => { if (!t.startsWith('"ethAddress"')) return; const j = '{' + t.replace(/[\s,{\]}]*$/, '') + '}';
    try { const x = JSON.parse(j); n++; const w = Object.fromEntries(x.windowPerformances), av = +x.accountValue, vb = +w.month.vlm / Math.max(1, av);
      if (av >= 1e5 && +w.month.pnl > 0 && +w.allTime.pnl > 0 && +w.week.pnl > -.05 * av && +w.month.roi >= .05 && +w.month.roi <= 5 && vb >= 3 && vb < 300)
        calon.push({ alamat: x.ethAddress, skor: { nilaiAkun: Math.round(av), untungBulan: Math.round(+w.month.pnl), roiBulan: +(+w.month.roi * 100).toFixed(1), untungTotal: Math.round(+w.allTime.pnl), nama: x.displayName } }); } catch { /* baris rusak dilewati */ } };
  for (;;) { const { value, done } = await baca.read(); if (done) break; buf += value; let awal = buf.indexOf('"ethAddress"'), i; if (awal < 0) continue;
    while ((i = buf.indexOf('"ethAddress"', awal + 1)) > 0) { proses(buf.slice(awal, i)); awal = i; } buf = buf.slice(awal); }
  proses(buf);
  const pilih = calon.sort((a, b) => b.skor.untungBulan - a.skor.untungBulan).slice(0, PAUS_N), kini = new Date().toISOString();
  const { data: lama } = await db.from('lantai_paus').select('alamat'); const tetap = new Set(pilih.map(x => x.alamat));
  const buang = (lama || []).map((x: any) => x.alamat).filter((a: string) => !tetap.has(a)); if (buang.length) await db.from('lantai_paus').delete().in('alamat', buang);
  for (const p of pilih) await db.from('lantai_paus').upsert({ alamat: p.alamat, skor: p.skor, dipilih: kini }, { onConflict: 'alamat' });
  return { ok: true, dibaca: n, lolosSaring: calon.length, dipilih: pilih.length, contoh: pilih.slice(0, 5).map(x => `${x.alamat.slice(0, 8)} akun $${x.skor.nilaiAkun} untung bulan ini $${x.skor.untungBulan} (${x.skor.roiBulan}%)`) }; }
// Posisi 30 trader dibaca tiap putaran. `sejak` = pertama kali posisi itu terlihat (null kalau sudah ada saat mulai dipantau),
// jadi "baru buka" = terlihat dalam 1 jam terakhir. Hasil: per pair Binance, jumlah trader long/short dan yang baru buka.
async function pantauPaus(kini: Date) {
  const { data: rows } = await db.from('lantai_paus').select('*'); if (!rows?.length) return null;
  const hasil: Record<string, Paus> = {}, t = kini.getTime();
  await Promise.all(rows.map(async (row: any) => { try {
    const j = await (await fetch(HL_INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'clearinghouseState', user: row.alamat }) })).json();
    const lama = row.posisi || {}, baru: Record<string, any> = {};
    for (const p of j.assetPositions || []) { const x = p.position, sisi = +x.szi > 0 ? 'long' : 'short', c = x.coin;
      baru[c] = { sisi, nilai: Math.round(+x.positionValue), sejak: lama[c]?.sisi === sisi ? lama[c].sejak : (row.diperiksa ? kini.toISOString() : null) };
      const b = hlKeBinance(c), h = hasil[b] ??= { long: 0, short: 0, baruLong: 0, baruShort: 0 }; h[sisi as 'long' | 'short']++;
      if (baru[c].sejak && t - Date.parse(baru[c].sejak) <= PAUS_BARU_MS) sisi === 'long' ? h.baruLong++ : h.baruShort++; }
    await db.from('lantai_paus').update({ posisi: baru, diperiksa: kini.toISOString() }).eq('alamat', row.alamat); } catch { /* dompet ini dilewati putaran ini */ } }));
  return hasil; }

// ---------- putaran
Deno.serve(async (req) => {
  const kunci = (await db.from('cs_rahasia').select('nilai').eq('nama', 'lantai_kunci').maybeSingle()).data?.nilai;
  if (!kunci || req.headers.get('x-lantai-kunci') !== kunci) return new Response('ditolak', { status: 401 });
  const log: string[] = [], kini = new Date();
  const badan = await req.json().catch(() => ({}));
  if (badan.segarPaus) { try { return new Response(JSON.stringify(await segarPaus()), { headers: { 'content-type': 'application/json' } }); } catch (e) { return new Response(JSON.stringify({ ok: false, galat: String(e) }), { status: 500 }); } }
  if (badan.ujiTestnet) return new Response(JSON.stringify(await ujiTestnet(badan.simbol || 'BTCUSDT')), { headers: { 'content-type': 'application/json' } });
  if (badan.pindai) {   // pindai semua pair untuk semua robot pada lilin terakhir yang sudah tutup, TANPA membuka posisi (untuk diperiksa)
    const t24 = await ambil(`${FAPI}/fapi/v1/ticker/24hr`), info = await ambil(`${FAPI}/fapi/v1/exchangeInfo`), premi = Object.fromEntries((await ambil(`${FAPI}/fapi/v1/premiumIndex`)).map((x: any) => [x.symbol, +x.lastFundingRate]));
    const ok = new Set(info.symbols.filter((s: any) => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.quoteAsset === 'USDT').map((s: any) => s.symbol));
    const semesta: string[] = t24.filter((x: any) => ok.has(x.symbol) && !STABIL.test(x.symbol) && +x.quoteVolume >= SEMESTA_VOL_MIN).sort((a: any, b: any) => +b.quoteVolume - +a.quoteVolume).slice(0, SEMESTA_N).map((x: any) => x.symbol);
    const { data: rr } = await db.from('lantai_robot').select('*').order('urut'), cache: Record<string, Promise<Lilin[]>> = {};
    const hasil = [] as any[];
    for (const r of rr!) { const S = STRATEGI[r.strategi], calon: string[] = [];
      for (let i = 0; i < semesta.length; i += 10) await Promise.all(semesta.slice(i, i + 10).map(async sim => { try { const k = await (cache[sim + r.interval] ??= lilin(sim, r.interval));
        const s = k.length >= 210 ? S.masuk({ k, funding: premi[sim] }) : null; if (s) calon.push(`${sim.replace('USDT', '')} ${s.sisi}: ${s.alasan}`); } catch { /* lewati */ } }));
      hasil.push({ robot: r.nama, interval: r.interval, sinyal: calon }); }
    return new Response(JSON.stringify({ ok: true, pair: semesta.length, semesta, hasil }), { headers: { 'content-type': 'application/json' } }); }
  if (badan.uji) {   // uji mundur tiap robot di beberapa koin besar (aturan sama dengan mesin), hasil dirata-rata
    const { data: rr } = await db.from('lantai_robot').select('*').order('urut'); const info = await ambil(`${FAPI}/fapi/v1/exchangeInfo`);
    const A = (sim: string) => { const s = info.symbols.find((x: any) => x.symbol === sim), f = Object.fromEntries(s.filters.map((x: any) => [x.filterType, x])); return { langkah: +f.LOT_SIZE.stepSize, minNilai: +(f.MIN_NOTIONAL?.notional ?? 5) }; };
    const hasil = await Promise.all(rr!.map(async r => { const per = [] as any[];
      for (const sim of UJI_KOIN) { try { per.push(await ujiMundur({ ...r, simbol: sim }, A(sim))); } catch (e) { per.push({ simbol: sim, galat: String(e).slice(0, 80) }); } }
      const ok = per.filter(x => !x.galat), n = ok.reduce((a, x) => a + x.transaksi, 0), m = ok.reduce((a, x) => a + x.menang, 0);
      return { robot: r.nama, transaksi: n, menang: m, rataHasil: ok.length ? +(ok.reduce((a, x) => a + parseFloat(x.hasil), 0) / ok.length).toFixed(1) + '%' : '-', perKoin: ok.map(x => `${x.simbol.replace('USDT', '')} ${x.hasil} (${x.menang}/${x.transaksi})`).join(', ') }; }));
    return new Response(JSON.stringify({ ok: true, koin: UJI_KOIN, hasil }), { headers: { 'content-type': 'application/json' } }); }
  try {
    const bisaLive = !!(KEY && SECRET);
    if (bisaLive) await db.from('cs_rahasia').upsert({ nama: 'lantai_bursa_siap', nilai: kini.toISOString() }); else await db.from('cs_rahasia').delete().eq('nama', 'lantai_bursa_siap');
    const { data: robot, error } = await db.from('lantai_robot').select('*').order('urut'); if (error) throw error;
    const { data: D0 } = await db.from('lantai_dompet').select('*').eq('id', 1).single();
    // Dompet bersama (13 Okt 2026, pemilik): satu saldo untuk 8 robot, paling banyak `maks_posisi` posisi bersamaan, rugi per
    // transaksi = risiko_persen x TINGKAT. Tingkat naik 3x setiap saldo menyentuh 3x tingkat ($100 -> risiko $3; $300 -> $9).
    // Rem darurat: saldo turun `rem_persen` dari PUNCAK saldo -> semua posisi ditutup, semua robot berhenti.
    // Robot dikeluarkan kalau rugi bersihnya sendiri >= keluar_persen x tingkat.
    // Semua pair (13 Okt 2026, pemilik: "jangan hanya di fokuskan 1 pair tetapi seluruh pair"): tiap robot memindai pair
    // USDT perpetual paling ramai dengan strateginya sendiri setiap lilin intervalnya tutup, lalu memilih sinyal terkuat.
    // Satu pair hanya dipegang satu robot.
    const D = { ...D0 }; let kasD = +D.kas;
    const bisaDemo = D.akun === 'demo' && !!(AKUN_DEMO.key && AKUN_DEMO.secret);
    const dipegang: Record<string, Set<string>> = { live: new Set(), demo: new Set() }, terpakai = new Set<string>();
    for (const r of robot!) if (r.posisi) { r.posisi.simbol ??= r.simbol; terpakai.add(r.posisi.simbol); const a = akunPos(r.posisi); if (a) dipegang[a].add(r.posisi.simbol); }
    const info = await ambil(`${FAPI}/fapi/v1/exchangeInfo`), aturanKoin: Record<string, { langkah: number; tik: number; minNilai: number }> = {}, bisaDiperdagangkan = new Set<string>();
    for (const s of info.symbols) { const f = Object.fromEntries(s.filters.map((x: any) => [x.filterType, x]));
      aturanKoin[s.symbol] = { langkah: +f.LOT_SIZE.stepSize, tik: +f.PRICE_FILTER.tickSize, minNilai: +(f.MIN_NOTIONAL?.notional ?? 5) };
      if (s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.quoteAsset === 'USDT') bisaDiperdagangkan.add(s.symbol); }
    let adaDemo: Set<string> | null = null;
    if (bisaDemo) adaDemo = await ambil(`${AKUN_DEMO.base}/fapi/v1/exchangeInfo`).then((j: any) => new Set<string>(j.symbols.filter((s: any) => s.status === 'TRADING').map((s: any) => s.symbol))).catch(() => null);
    const premi = Object.fromEntries((await ambil(`${FAPI}/fapi/v1/premiumIndex`)).map((x: any) => [x.symbol, { mark: +x.markPrice, funding: +x.lastFundingRate }]));
    const t24 = await ambil(`${FAPI}/fapi/v1/ticker/24hr`), volume: Record<string, number> = Object.fromEntries(t24.map((x: any) => [x.symbol, +x.quoteVolume]));
    const semesta: string[] = t24.filter((x: any) => bisaDiperdagangkan.has(x.symbol) && !STABIL.test(x.symbol) && +x.quoteVolume >= SEMESTA_VOL_MIN && (!adaDemo || adaDemo.has(x.symbol)))
      .sort((a: any, b: any) => +b.quoteVolume - +a.quoteVolume).slice(0, SEMESTA_N).map((x: any) => x.symbol);
    const cache: Record<string, Promise<Lilin[]>> = {}, ambilLilin = (s: string, iv: string) => cache[s + iv] ??= lilin(s, iv);
    const layak = (x: string) => bisaDiperdagangkan.has(x) && (volume[x] ?? 0) >= BESAR_VOL_MIN && (!adaDemo || adaDemo.has(x));
    const besar = BESAR.filter(layak), luas = [...new Set([...besar, ...semesta])];
    const pakaiPaus = robot!.some(r => r.strategi === 'ikut-paus' && (r.status === 'aktif' || r.posisi));
    const paus = pakaiPaus ? await pantauPaus(kini).catch(e => { log.push('Pengintai: data Hyperliquid gagal ' + String(e).slice(0, 80)); return null; }) : null;
    const pausKoin = (sim: string) => paus ? (paus[sim] ?? { long: 0, short: 0, baruLong: 0, baruShort: 0 }) : undefined;
    const kumpulanPair = (strategi: string) => { const k = KUMPULAN[strategi] ?? 'luas';
      if (k === 'paus') return paus ? Object.entries(paus).filter(([sim, h]) => (h.baruLong >= 2 || h.baruShort >= 2) && layak(sim)).map(([sim]) => sim) : [];
      return k === 'besar' ? besar : luas; };
    const bulat = (v: number, l: number) => Math.floor(v / l + 1e-9) * l, dp = (l: number) => Math.max(0, -Math.floor(Math.log10(l)));
    const R = [] as any[];   // keadaan kerja tiap robot selama putaran

    // ---- tahap 1: urus posisi terbuka
    for (const r of robot!) {
      const S = STRATEGI[r.strategi];
      const w: any = { r, S, st: { transaksi: 0, menang: 0, kalah: 0, pnl: 0, ...(r.statistik || {}) }, pnl: +r.kas, pos: r.posisi, status: r.status, live: !!r.live, catatan: r.catatan };
      // akun bursa yang dipakai robot ini untuk posisi BARU: live (saklar pemilik + kunci) > demo (dompet.akun) > catatan saja
      const mintaLive = w.live || D.akun === 'live';
      w.akunPilihan = mintaLive && bisaLive ? 'live' : bisaDemo ? 'demo' : null;
      if (mintaLive && !bisaLive) w.catatan = 'Uang sungguhan dipilih, tapi kunci Binance belum dipasang. Tetap simulasi.';
      w.tutup = async (harga: number, alasan: string, olehBursa = false) => { const pos = w.pos, sim = pos.simbol, a = akunPos(pos); let keluar = harga;
        if (a && !olehBursa) { await batalSemua(AKUN[a], sim);
          const o = await bursa('POST', '/fapi/v1/order', { symbol: sim, side: pos.sisi === 'long' ? 'SELL' : 'BUY', type: 'MARKET', quantity: pos.qty.toFixed(dp(aturanKoin[sim].langkah)), reduceOnly: true, newOrderRespType: 'RESULT' }, AKUN[a]);
          keluar = +o.avgPrice || harga; }
        else if (!a) keluar = harga * (pos.sisi === 'long' ? 1 - SELIP : 1 + SELIP);
        if (a && olehBursa) { await batalSemua(AKUN[a], sim);   // order pengaman pasangannya jangan tertinggal
          const t = (await bursa('GET', '/fapi/v1/userTrades', { symbol: sim, startTime: Date.parse(pos.waktu), limit: 50 }, AKUN[a]).catch(() => []))
            .filter((x: any) => x.side === (pos.sisi === 'long' ? 'SELL' : 'BUY')).at(-1); if (t) keluar = +t.price; }
        if (a) dipegang[a].delete(sim); terpakai.delete(sim);
        const arah = pos.sisi === 'long' ? 1 : -1, kotor = (keluar - pos.masuk) * pos.qty * arah, biaya = (pos.masuk + keluar) * pos.qty * BIAYA, bersih = kotor - biaya;
        w.pnl += bersih; kasD += bersih; w.st.transaksi++; bersih > 0 ? w.st.menang++ : w.st.kalah++; w.st.pnl = (w.st.pnl || 0) + bersih;
        await db.from('lantai_transaksi').insert({ robot: r.id, data: { sisi: pos.sisi, masuk: pos.masuk, keluar, qty: pos.qty, leverage: pos.leverage, risiko: pos.risiko, rr: pos.rr, pnl: +bersih.toFixed(4), biaya: +biaya.toFixed(4), alasanMasuk: pos.alasan, alasanKeluar: alasan, waktuMasuk: pos.waktu, waktuKeluar: kini.toISOString(), live: a === 'live', akun: a ?? 'simulasi', simbol: sim } });
        log.push(`${r.nama} tutup ${pos.sisi} ${sim} ${bersih >= 0 ? '+' : ''}${bersih.toFixed(2)} (${alasan})`); w.pos = null; };
      if (w.pos) { const sim = w.pos.simbol;
        try { w.k = await ambilLilin(sim, r.interval); w.mark = premi[sim]?.mark ?? w.k[w.k.length - 1].c; w.ctx = { k: w.k, funding: premi[sim]?.funding, paus: pausKoin(sim) }; }
        catch (e) { w.mark = premi[sim]?.mark ?? w.pos.masuk; w.galat = `data ${sim}: ${String((e as Error).message).slice(0, 80)}`; log.push(`${r.nama}: ${w.galat}`); } }
      if (w.pos && w.k) try { const pos = w.pos, sim = pos.simbol, k = w.k, mark = w.mark;
          const a = akunPos(pos); if (a) { const pr = (await bursa('GET', '/fapi/v2/positionRisk', { symbol: sim }, AKUN[a]))[0]; if (pr && +pr.positionAmt === 0) await w.tutup(pos.sl, 'ditutup bursa (stop loss atau take profit)', true); }
          if (w.pos) for (const x of k.filter(x => x.t > Date.parse(w.pos.waktu))) {
            const kenaSl = w.pos.sisi === 'long' ? x.l <= w.pos.sl : x.h >= w.pos.sl, kenaTp = w.pos.tp != null && (w.pos.sisi === 'long' ? x.h >= w.pos.tp : x.l <= w.pos.tp);
            if (kenaSl) { await w.tutup(w.pos.sl, 'stop loss'); break; } if (kenaTp) { await w.tutup(w.pos.tp, 'take profit'); break; } }
          if (w.pos && S.jejak) { const g = S.jejak(w.ctx, w.pos.sisi); if (g != null && (w.pos.sisi === 'long' ? g > w.pos.sl : g < w.pos.sl)) { w.pos.sl = g;
            const a = akunPos(w.pos); if (a) { await batalSemua(AKUN[a], sim); await pasangPengaman(AKUN[a], sim, w.pos.sisi, g, w.pos.tp, aturanKoin[sim].tik); } } }   // stop loss di bursa ikut digeser
          if (w.pos && S.keluar) { const a = S.keluar(w.ctx, w.pos.sisi); if (a) await w.tutup(mark, a); }
          if (w.pos && S.maksLilin && k.filter(x => x.t > Date.parse(w.pos.waktu)).length >= S.maksLilin) await w.tutup(mark, `sudah ${S.maksLilin} lilin`);
          if (w.pos && !w.pos.rr && w.pos.qty > 0 && w.pos.risiko > 0) { const rr = Math.max(RR_MIN, S.rr), arah = w.pos.sisi === 'long' ? 1 : -1, tpBaru = w.pos.masuk + arah * rr * (w.pos.risiko / w.pos.qty);
            if (arah * (mark - tpBaru) >= 0) await w.tutup(mark, `sudah melewati target 1:${rr}`);
            else { w.pos.tp = tpBaru; w.pos.rr = rr; const a = akunPos(w.pos); if (a) { await batalSemua(AKUN[a], sim); await pasangPengaman(AKUN[a], sim, w.pos.sisi, w.pos.sl, tpBaru, aturanKoin[sim].tik); }
              log.push(`${r.nama} take profit disesuaikan ke 1:${rr} (${tpBaru})`); } }
          // posisi simulasi yang dibuka sebelum akun demo dinyalakan dipindah ke Binance Demo (jumlah, SL, TP sama). Hanya ke DEMO.
          if (w.pos && !akunPos(w.pos) && w.akunPilihan === 'demo' && !dipegang.demo.has(sim) && (!adaDemo || adaDemo.has(sim)) && (w.pos.sisi === 'long' ? mark > w.pos.sl : mark < w.pos.sl)) {
            const B = AKUN.demo, A = aturanKoin[sim], q = w.pos.qty.toFixed(dp(A.langkah));
            await bursa('POST', '/fapi/v1/marginType', { symbol: sim, marginType: 'ISOLATED' }, B).catch(() => null);
            await bursa('POST', '/fapi/v1/leverage', { symbol: sim, leverage: w.pos.leverage || 1 }, B);
            const o = await bursa('POST', '/fapi/v1/order', { symbol: sim, side: w.pos.sisi === 'long' ? 'BUY' : 'SELL', type: 'MARKET', quantity: q, newOrderRespType: 'RESULT' }, B);
            dipegang.demo.add(sim);
            try { await pasangPengaman(B, sim, w.pos.sisi, w.pos.sl, w.pos.tp, A.tik); }
            catch (e) { await bursa('POST', '/fapi/v1/order', { symbol: sim, side: w.pos.sisi === 'long' ? 'SELL' : 'BUY', type: 'MARKET', quantity: q, reduceOnly: true }, B).catch(() => null);
              await batalSemua(B, sim); dipegang.demo.delete(sim); throw new Error('pindah ke demo batal, stop loss gagal dipasang: ' + (e as Error).message); }
            w.pos.akun = 'demo'; w.pos.masukBursa = +o.avgPrice || mark; log.push(`${r.nama} posisi ${w.pos.sisi} ${sim} dipindah ke Binance Demo di ${w.pos.masukBursa}`); }
        } catch (e) { w.galat = String((e as Error).message || e).slice(0, 200); log.push(`${r.nama}: ${w.galat}`); }
      R.push(w); }

    // ---- UANG SUNGGUHAN untuk seluruh dompet (dompet.akun = 'live', dipilih pemilik sendiri di lantai.html). Saldo diambil dari
    // akun futures Binance pemilik. Putaran pertama: posisi demo/simulasi yang masih terbuka ditutup, saldo asli jadi modal
    // awal, tingkat, dan puncak (risiko 3% saldo asli), hitungan untung-rugi robot mulai dari 0.
    const modeLive = D.akun === 'live' && bisaLive; let larangBuka = false;
    if (D.akun === 'live' && !bisaLive) { larangBuka = true; D.catatan = 'Uang sungguhan dipilih, tapi BINANCE_KEY dan BINANCE_SECRET belum dipasang di Supabase.'; }
    if (modeLive) {
      const ak = await bursa('GET', '/fapi/v2/account', {}), saldo = +ak.totalWalletBalance;
      if (!D.mulai_live) {
        if (saldo < 10) { larangBuka = true; D.catatan = `Uang sungguhan dipilih, tapi saldo dompet futures Binance baru ${saldo.toFixed(2)} USDT. Pindahkan USDT ke dompet USDⓈ-M Futures dulu.`; log.push('LIVE menunggu saldo'); }
        else {
          for (const w of R) if (w.pos && akunPos(w.pos) !== 'live') await w.tutup(w.mark, 'ditutup: pindah ke uang sungguhan').catch(e => log.push(`${w.r.nama}: ${String(e).slice(0, 120)}`));
          kasD = saldo; D.modal_awal = saldo; D.tingkat = saldo; D.puncak = saldo; D.mulai_live = kini.toISOString(); D.status = 'aktif';
          D.catatan = `Mulai uang sungguhan ${kini.toISOString().slice(0, 16).replace('T', ' ')} UTC dengan saldo ${saldo.toFixed(2)} USDT.`;
          for (const w of R) { w.pnl = 0; w.st = { ...w.st, transaksi: 0, menang: 0, kalah: 0, pnl: 0 }; }
          await db.from('lantai_modal').delete().lt('waktu', kini.toISOString()); log.push(`MULAI UANG SUNGGUHAN, saldo ${saldo}`); } }
      else kasD = saldo; }

    // ---- saldo, tingkat, rem darurat, robot yang dikeluarkan
    const terbuka = (w: any) => w.pos ? (w.mark - w.pos.masuk) * w.pos.qty * (w.pos.sisi === 'long' ? 1 : -1) : 0;
    let ekuitas = kasD + R.reduce((a, w) => a + terbuka(w), 0);
    while (ekuitas >= 3 * +D.tingkat) { D.tingkat = 3 * +D.tingkat; log.push(`Tingkat naik ke ${D.tingkat}, risiko per transaksi ${(+D.risiko_persen * D.tingkat).toFixed(2)}`); }
    D.puncak = Math.max(+D.puncak || 0, ekuitas);
    const batasRem = (1 - +D.rem_persen) * +D.puncak;
    if (D.status === 'aktif' && ekuitas <= batasRem) {
      for (const w of R) if (w.pos) await w.tutup(w.mark, 'rem darurat saldo').catch(e => log.push(`${w.r.nama}: rem darurat gagal menutup: ${String(e).slice(0, 120)}`));
      D.status = 'berhenti'; D.catatan = `Rem darurat ${kini.toISOString().slice(0, 16).replace('T', ' ')} UTC: saldo ${ekuitas.toFixed(2)} turun ${((1 - ekuitas / +D.puncak) * 100).toFixed(1)}% dari puncak ${(+D.puncak).toFixed(2)} (batas ${(+D.rem_persen * 100).toFixed(0)}%). Semua posisi ditutup, semua robot berhenti.`; log.push('REM DARURAT');
      ekuitas = kasD + R.reduce((a, w) => a + terbuka(w), 0); }
    const batasRobot = -(+D.keluar_persen) * +D.tingkat;
    for (const w of R) if (w.status === 'aktif' && w.pnl + terbuka(w) <= batasRobot) { if (w.pos) await w.tutup(w.mark, 'batas rugi robot tersentuh').catch(() => null);
      w.status = 'dikeluarkan'; w.live = false; w.catatan = `Dikeluarkan ${kini.toISOString().slice(0, 16).replace('T', ' ')} UTC: rugi bersih robot ${w.pnl.toFixed(2)} mencapai batas ${batasRobot.toFixed(2)}.`; log.push(`${w.r.nama} DIKELUARKAN`); }
    ekuitas = kasD + R.reduce((a, w) => a + terbuka(w), 0);

    // ---- tahap 2: pindai semua pair, posisi baru (slot terbatas, risiko tetap per tingkat, leverage menyesuaikan)
    const risikoUsd = +D.risiko_persen * +D.tingkat, maks = +D.maks_posisi;
    let marginPakai = R.reduce((a, w) => a + (w.pos ? w.pos.qty * w.pos.masuk / (w.pos.leverage || 1) : 0), 0), jumlahPos = R.filter(w => w.pos).length;
    for (const w of R) { const r = w.r, S = w.S, ms = IV_MS[r.interval], akhir = Math.floor(kini.getTime() / ms) * ms - ms;   // waktu buka lilin terakhir yang sudah tutup
      if (w.galat || w.pos || w.status !== 'aktif' || D.status !== 'aktif' || larangBuka || w.st.lilinDinilai === akhir) continue;
      w.st.lilinDinilai = akhir;
      if (jumlahPos >= maks) { w.st.pindai = { waktu: kini.toISOString(), pair: 0, sinyal: 0, teks: `tidak memindai: sudah ${maks} posisi terbuka` }; continue; }
      const daftar = kumpulanPair(r.strategi).filter(s => !terpakai.has(s)); let calon: any[] = [];
      for (let i = 0; i < daftar.length; i += 10) await Promise.all(daftar.slice(i, i + 10).map(async sim => { try {
        const k = await ambilLilin(sim, r.interval); if (k.length < 210 || k[k.length - 1].t !== akhir) return;
        const s = S.masuk({ k, funding: premi[sim]?.funding, paus: pausKoin(sim) }); if (s) calon.push({ sim, s }); } catch { /* pair ini dilewati */ } }));
      calon = undiBerbobot(calon);   // diundi, sinyal yang lebih kuat lebih besar peluangnya
      w.st.pindai = { waktu: kini.toISOString(), pair: daftar.length, sinyal: calon.length, teks: calon.length ? calon.slice(0, 4).map(c => `${c.sim.replace('USDT', '')} ${c.s.sisi}`).join(', ') : 'tidak ada pair yang memenuhi aturan' };
      const alasanLewat: string[] = [];
      for (const { sim, s } of calon) {
        const A = aturanKoin[sim], mark = premi[sim]?.mark; if (!A || !mark) continue;
        const harga = mark * (s.sisi === 'long' ? 1 + SELIP : 1 - SELIP), jarak = Math.abs(harga - s.sl), d = jarak / harga;
        if (s.sisi === 'long' ? s.sl >= harga : s.sl <= harga) { alasanLewat.push(`${sim}: harga sudah lewat stop loss`); continue; }
        const levAman = Math.max(1, Math.min(+D.lev_maks, Math.floor(.8 / d)));   // likuidasi isolated sekitar 1/leverage, harus lebih jauh dari stop loss
        // rugi per koin kalau stop loss kena = jarak + biaya masuk & keluar + selip saat stop loss tereksekusi; jadi rugi total
        // (termasuk biaya) tetap paling besar risikoUsd sesuai aturan pemilik
        const rugiPerKoin = jarak + (harga + s.sl) * BIAYA + s.sl * SELIP;
        let qty = bulat(risikoUsd / rugiPerKoin, A.langkah), nilai = qty * harga, lev = Math.max(1, Math.ceil(nilai / (ekuitas / maks)));
        if (lev > levAman) { lev = levAman; qty = bulat(levAman * (ekuitas / maks) / harga, A.langkah); nilai = qty * harga; }
        const margin = nilai / lev;
        if (nilai < A.minNilai) { alasanLewat.push(`${sim}: nilai ${nilai.toFixed(2)} di bawah minimal ${A.minNilai}`); continue; }
        if (marginPakai + margin > ekuitas) { alasanLewat.push(`${sim}: margin tidak muat`); continue; }
        const a = w.akunPilihan && !dipegang[w.akunPilihan].has(sim) ? w.akunPilihan : null;
        const tpDari = (m: number) => m + (s.sisi === 'long' ? 1 : -1) * Math.max(RR_MIN, S.rr) * Math.abs(m - s.sl);
        try { let masuk = harga;
          if (a) { const B = AKUN[a]; await bursa('POST', '/fapi/v1/marginType', { symbol: sim, marginType: 'ISOLATED' }, B).catch(() => null); await bursa('POST', '/fapi/v1/leverage', { symbol: sim, leverage: lev }, B);
            const o = await bursa('POST', '/fapi/v1/order', { symbol: sim, side: s.sisi === 'long' ? 'BUY' : 'SELL', type: 'MARKET', quantity: qty.toFixed(dp(A.langkah)), newOrderRespType: 'RESULT' }, B); masuk = +o.avgPrice || mark;
            dipegang[a].add(sim);
            try { await pasangPengaman(B, sim, s.sisi, s.sl, tpDari(masuk), A.tik); }
            catch (e) { await bursa('POST', '/fapi/v1/order', { symbol: sim, side: s.sisi === 'long' ? 'SELL' : 'BUY', type: 'MARKET', quantity: qty.toFixed(dp(A.langkah)), reduceOnly: true }, B).catch(() => null);
              await batalSemua(B, sim); dipegang[a].delete(sim); throw new Error('stop loss gagal dipasang, posisi langsung ditutup: ' + (e as Error).message); } }
          w.pos = { simbol: sim, sisi: s.sisi, masuk, qty, sl: s.sl, slAwal: s.sl, tp: tpDari(masuk), rr: Math.max(RR_MIN, S.rr), alasan: s.alasan, waktu: new Date(akhir).toISOString(), live: a === 'live', akun: a, leverage: lev, risiko: +(qty * rugiPerKoin).toFixed(4), margin: +margin.toFixed(4) };
          w.mark = mark; marginPakai += margin; jumlahPos++; terpakai.add(sim);
          w.st.terakhirSinyal = { waktu: kini.toISOString(), teks: `${sim.replace('USDT', '')}: ${s.alasan}` };
          log.push(`${r.nama} buka ${s.sisi} ${sim} di ${masuk}, ${lev}x, risiko ${(qty * rugiPerKoin).toFixed(2)}, 1:${Math.max(RR_MIN, S.rr)} (${s.alasan}; ${calon.length} sinyal dari ${daftar.length} pair)${a ? ' ' + a.toUpperCase() : ''}`); break; }
        catch (e) { alasanLewat.push(`${sim}: ${String((e as Error).message || e).slice(0, 120)}`); } }
      if (!w.pos && alasanLewat.length) w.st.terakhirSinyal = { waktu: kini.toISOString(), teks: 'dilewati: ' + alasanLewat.slice(0, 3).join('; ') }; }

    // ---- simpan
    const perRobot: Record<string, number> = {};
    for (const w of R) { const t = terbuka(w); if (w.pos) w.pos.terbuka = +t.toFixed(4); perRobot[w.r.id] = +(w.pnl + t).toFixed(4);
      w.st.mark = w.pos ? w.mark : null; w.st.aturan = w.S.aturan; w.st.judul = w.S.judul; w.st.semesta = kumpulanPair(w.r.strategi).length; w.st.kumpulan = KUMPULAN[w.r.strategi] ?? 'luas';
      await db.from('lantai_robot').update({ kas: +w.pnl.toFixed(6), posisi: w.pos, status: w.status, live: w.live, catatan: w.galat ? 'Galat putaran terakhir: ' + w.galat : w.catatan, statistik: w.st, diubah: kini.toISOString() }).eq('id', w.r.id); }
    ekuitas = kasD + R.reduce((a, w) => a + terbuka(w), 0);
    if (modeLive && D.mulai_live) { const ak = await bursa('GET', '/fapi/v2/account', {}).catch(() => null); if (ak) { kasD = +ak.totalWalletBalance; ekuitas = kasD + +ak.totalUnrealizedProfit; } }   // angka akhir = saldo asli Binance
    D.puncak = Math.max(+D.puncak || 0, ekuitas);
    await db.from('lantai_dompet').update({ kas: +kasD.toFixed(6), tingkat: D.tingkat, status: D.status, catatan: D.catatan, puncak: +D.puncak.toFixed(4), ekuitas: +ekuitas.toFixed(4), modal_awal: D.modal_awal, mulai_live: D.mulai_live ?? null, diubah: kini.toISOString() }).eq('id', 1);
    await db.from('lantai_modal').insert({ waktu: kini.toISOString(), total: +ekuitas.toFixed(4), per_robot: perRobot });
    return new Response(JSON.stringify({ ok: true, total: +ekuitas.toFixed(2), tingkat: D.tingkat, posisi: jumlahPos, pair: { besar: besar.length, luas: luas.length, paus: paus ? Object.keys(paus).length : null }, log }), { headers: { 'content-type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ ok: false, galat: String((e as Error).message || e), log }), { status: 500, headers: { 'content-type': 'application/json' } }); }
});
