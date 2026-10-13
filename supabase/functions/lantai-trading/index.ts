// Lantai Trading (13 Okt 2026): mesin 8 robot Binance USDT-M futures. Dipanggil pg_cron tiap 5 menit (lantai__tick,
// header x-region ap-south-1 dan x-lantai-kunci). Aturan tiap robot ditulis sebelum robot berjalan:
//   - satu robot satu strategi satu koin, satu posisi sekaligus;
//   - ukuran posisi: rugi kalau stop loss kena = `risiko` x kas (bawaan 2%), nilai posisi paling besar kas x leverage;
//   - stop loss selalu dipasang; take profit kalau strateginya punya;
//   - modal turun sampai (1 - batas_rugi) x modal awal (bawaan 20%) -> posisi ditutup, robot DIKELUARKAN, tidak trading lagi
//     sampai pemilik memulai ulang.
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
type Sinyal = { sisi: 'long' | 'short'; sl: number; tp: number | null; alasan: string } | null;
type Ctx = { k: Lilin[]; funding?: number };
const STRATEGI: Record<string, { judul: string; aturan: string; masuk: (x: Ctx) => Sinyal; keluar?: (x: Ctx, sisi: string) => string | null; maksLilin?: number; jejak?: (x: Ctx, sisi: string) => number | null }> = {
  'ikut-tren': { judul: 'Ikut tren', aturan: 'EMA 20 memotong EMA 50: ke atas long, ke bawah short. Stop loss 2 ATR, take profit 4 ATR, keluar kalau potongan berbalik.',
    masuk: ({ k }) => { const c = k.map(x => x.c), a = ema(c, 20), b = ema(c, 50), t = atr(k), i = c.length - 1;
      if (a[i] > b[i] && a[i - 1] <= b[i - 1]) return { sisi: 'long', sl: c[i] - 2 * t[i], tp: c[i] + 4 * t[i], alasan: 'EMA 20 memotong EMA 50 ke atas' };
      if (a[i] < b[i] && a[i - 1] >= b[i - 1]) return { sisi: 'short', sl: c[i] + 2 * t[i], tp: c[i] - 4 * t[i], alasan: 'EMA 20 memotong EMA 50 ke bawah' }; return null; },
    keluar: ({ k }, s) => { const c = k.map(x => x.c), a = ema(c, 20), b = ema(c, 50), i = c.length - 1; return (s === 'long' ? a[i] < b[i] : a[i] > b[i]) ? 'tren berbalik' : null; } },
  'tembus-kisaran': { judul: 'Tembus kisaran', aturan: 'Harga tutup di atas tertinggi 20 lilin: long; di bawah terendah 20 lilin: short. Stop loss 1,5 ATR, keluar kalau tembus balik kisaran 10 lilin.',
    masuk: ({ k }) => { const i = k.length - 1, s = k.slice(i - 20, i), hh = Math.max(...s.map(x => x.h)), ll = Math.min(...s.map(x => x.l)), t = atr(k)[i], c = k[i].c;
      if (c > hh) return { sisi: 'long', sl: c - 1.5 * t, tp: null, alasan: 'tutup di atas tertinggi 20 lilin' }; if (c < ll) return { sisi: 'short', sl: c + 1.5 * t, tp: null, alasan: 'tutup di bawah terendah 20 lilin' }; return null; },
    keluar: ({ k }, s) => { const i = k.length - 1, w = k.slice(i - 10, i); return s === 'long' ? (k[i].c < Math.min(...w.map(x => x.l)) ? 'tembus balik ke bawah kisaran 10 lilin' : null) : (k[i].c > Math.max(...w.map(x => x.h)) ? 'tembus balik ke atas kisaran 10 lilin' : null); } },
  'pantulan-rsi': { judul: 'Pantulan RSI', aturan: 'RSI 14 naik dari bawah 35 dan harga di atas EMA 200: long; turun dari atas 65 dan harga di bawah EMA 200: short. Stop loss 1,5 ATR, take profit 2 ATR, keluar di RSI 60 atau 40.',
    masuk: ({ k }) => { const c = k.map(x => x.c), r = rsi(c), e = ema(c, 200), t = atr(k), i = c.length - 1;
      if (r[i - 1] < 35 && r[i] >= 35 && c[i] > e[i]) return { sisi: 'long', sl: c[i] - 1.5 * t[i], tp: c[i] + 2 * t[i], alasan: `RSI naik dari ${r[i - 1].toFixed(0)} ke ${r[i].toFixed(0)}, harga di atas EMA 200` };
      if (r[i - 1] > 65 && r[i] <= 65 && c[i] < e[i]) return { sisi: 'short', sl: c[i] + 1.5 * t[i], tp: c[i] - 2 * t[i], alasan: `RSI turun dari ${r[i - 1].toFixed(0)} ke ${r[i].toFixed(0)}, harga di bawah EMA 200` }; return null; },
    keluar: ({ k }, s) => { const r = rsi(k.map(x => x.c)), i = r.length - 1; return s === 'long' ? (r[i] > 60 ? 'RSI sudah 60' : null) : (r[i] < 40 ? 'RSI sudah 40' : null); } },
  'kembali-ke-tengah': { judul: 'Kembali ke tengah', aturan: 'Harga tutup di luar pita Bollinger (20, 2): di bawah pita long, di atas pita short. Take profit di garis tengah, stop loss 1,5 ATR.',
    masuk: ({ k }) => { const c = k.map(x => x.c), m = sma(c, 20), i = c.length - 1, sd = Math.sqrt(c.slice(i - 19).reduce((a, x) => a + (x - m[i]) ** 2, 0) / 20), t = atr(k)[i];
      if (c[i] < m[i] - 2 * sd) return { sisi: 'long', sl: c[i] - 1.5 * t, tp: m[i], alasan: 'tutup di bawah pita bawah Bollinger' };
      if (c[i] > m[i] + 2 * sd) return { sisi: 'short', sl: c[i] + 1.5 * t, tp: m[i], alasan: 'tutup di atas pita atas Bollinger' }; return null; },
    maksLilin: 24 },
  'momentum-macd': { judul: 'Momentum MACD', aturan: 'Garis MACD (12, 26) memotong sinyal (9) searah posisi nol: di atas nol long, di bawah nol short. Stop loss 2 ATR, take profit 3 ATR, paling lama 24 lilin.',
    masuk: ({ k }) => { const c = k.map(x => x.c), a = ema(c, 12), b = ema(c, 26), m = a.map((x, i) => x - b[i]), s = ema(m, 9), t = atr(k), i = c.length - 1;
      if (m[i] > s[i] && m[i - 1] <= s[i - 1] && m[i] > 0) return { sisi: 'long', sl: c[i] - 2 * t[i], tp: c[i] + 3 * t[i], alasan: 'MACD memotong sinyal ke atas di atas nol' };
      if (m[i] < s[i] && m[i - 1] >= s[i - 1] && m[i] < 0) return { sisi: 'short', sl: c[i] + 2 * t[i], tp: c[i] - 3 * t[i], alasan: 'MACD memotong sinyal ke bawah di bawah nol' }; return null; },
    maksLilin: 24 },
  'lonjakan-volume': { judul: 'Lonjakan volume', aturan: 'Volume lebih dari 3 kali rata-rata 20 lilin dan badan lilin lebih dari 60% rentangnya: ikut arah lilin. Stop loss 1 ATR, take profit 2 ATR, paling lama 8 lilin.',
    masuk: ({ k }) => { const i = k.length - 1, x = k[i], rata = k.slice(i - 20, i).reduce((a, y) => a + y.v, 0) / 20, t = atr(k)[i], badan = Math.abs(x.c - x.o), rentang = x.h - x.l || 1e-12;
      if (x.v > 3 * rata && badan > .6 * rentang) return x.c > x.o ? { sisi: 'long', sl: x.c - t, tp: x.c + 2 * t, alasan: `volume ${(x.v / rata).toFixed(1)}x rata-rata, lilin naik` } : { sisi: 'short', sl: x.c + t, tp: x.c - 2 * t, alasan: `volume ${(x.v / rata).toFixed(1)}x rata-rata, lilin turun` };
      return null; }, maksLilin: 8 },
  'lawan-funding': { judul: 'Lawan funding', aturan: 'Funding rate di atas 0,03% (terlalu banyak long): short; di bawah -0,01% (terlalu banyak short): long. Stop loss 1,5 ATR, take profit 2 ATR, paling lama 8 jam.',
    masuk: ({ k, funding }) => { if (funding == null) return null; const i = k.length - 1, t = atr(k)[i], c = k[i].c;
      if (funding > .0003) return { sisi: 'short', sl: c + 1.5 * t, tp: c - 2 * t, alasan: `funding ${(funding * 100).toFixed(3)}%, pasar terlalu condong long` };
      if (funding < -.0001) return { sisi: 'long', sl: c - 1.5 * t, tp: c + 2 * t, alasan: `funding ${(funding * 100).toFixed(3)}%, pasar terlalu condong short` }; return null; },
    maksLilin: 8 },
  'supertrend': { judul: 'Supertrend', aturan: 'Supertrend (10, 3) berbalik arah: ikut arah baru. Stop loss di garis supertrend dan ikut bergeser, keluar kalau supertrend berbalik lagi.',
    masuk: ({ k }) => { const { garis, arah } = supertrend(k), i = k.length - 1;
      if (arah[i] === 1 && arah[i - 1] === -1) return { sisi: 'long', sl: garis[i], tp: null, alasan: 'supertrend berbalik naik' };
      if (arah[i] === -1 && arah[i - 1] === 1) return { sisi: 'short', sl: garis[i], tp: null, alasan: 'supertrend berbalik turun' }; return null; },
    keluar: ({ k }, s) => { const { arah } = supertrend(k), i = k.length - 1; return (s === 'long' ? arah[i] === -1 : arah[i] === 1) ? 'supertrend berbalik' : null; },
    jejak: ({ k }) => supertrend(k).garis[k.length - 1] },
};

// ---------- Binance bertanda tangan (hanya untuk robot live)
type Akun = { base: string; key: string; secret: string };
const AKUN_LIVE: Akun = { base: FAPI, key: KEY, secret: SECRET };
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
  let kas = +r.modal_awal, pos: any = null, puncak = kas, dd = 0, n = 0, menang = 0, dilewati = 0; const daftar: string[] = [];
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
    if (modal <= +r.modal_awal * (1 - +r.batas_rugi)) { if (pos) tutup(x.c, 'batas rugi', x.t); daftar.push('DIKELUARKAN di ' + new Date(x.t).toISOString().slice(5, 16)); break; }
    if (!pos) { const s = S.masuk(ctx); if (s) { const harga = x.c * (s.sisi === 'long' ? 1 + SELIP : 1 - SELIP), jarak = Math.abs(harga - s.sl);
      let qty = Math.min(jarak > 0 ? kas * +r.risiko / jarak : 0, kas * +r.leverage / harga); qty = Math.floor(qty / A.langkah + 1e-9) * A.langkah;
      if (qty * harga < A.minNilai || (s.sisi === 'long' ? s.sl >= harga : s.sl <= harga)) dilewati++; else pos = { ...s, masuk: harga, qty, i, t: x.t }; } } }
  return { robot: r.nama, simbol: r.simbol, interval: r.interval, dari: new Date(K[210].t).toISOString().slice(0, 10), sampai: new Date(K.at(-1)!.t).toISOString().slice(0, 10),
    transaksi: n, menang, kas: +kas.toFixed(2), hasil: +((kas / +r.modal_awal - 1) * 100).toFixed(1) + '%', ddMaks: +(dd * 100).toFixed(1) + '%', dilewati, contoh: daftar }; }

// ---------- putaran
Deno.serve(async (req) => {
  const kunci = (await db.from('cs_rahasia').select('nilai').eq('nama', 'lantai_kunci').maybeSingle()).data?.nilai;
  if (!kunci || req.headers.get('x-lantai-kunci') !== kunci) return new Response('ditolak', { status: 401 });
  const log: string[] = [], kini = new Date();
  const badan = await req.json().catch(() => ({}));
  if (badan.ujiTestnet) return new Response(JSON.stringify(await ujiTestnet(badan.simbol || 'BTCUSDT')), { headers: { 'content-type': 'application/json' } });
  if (badan.uji) { const { data: rr } = await db.from('lantai_robot').select('*').order('urut'); const info = await ambil(`${FAPI}/fapi/v1/exchangeInfo`), hasil = [];
    for (const r of rr!) { const s = info.symbols.find((x: any) => x.symbol === r.simbol), f = Object.fromEntries(s.filters.map((x: any) => [x.filterType, x]));
      try { hasil.push(await ujiMundur(r, { langkah: +f.LOT_SIZE.stepSize, minNilai: +(f.MIN_NOTIONAL?.notional ?? 5) })); } catch (e) { hasil.push({ robot: r.nama, galat: String(e) }); } }
    return new Response(JSON.stringify({ ok: true, hasil }), { headers: { 'content-type': 'application/json' } }); }
  try {
    const bisaLive = !!(KEY && SECRET);
    if (bisaLive) await db.from('cs_rahasia').upsert({ nama: 'lantai_bursa_siap', nilai: kini.toISOString() }); else await db.from('cs_rahasia').delete().eq('nama', 'lantai_bursa_siap');
    const { data: robot, error } = await db.from('lantai_robot').select('*').order('urut'); if (error) throw error;
    const info = await ambil(`${FAPI}/fapi/v1/exchangeInfo`), aturanKoin: Record<string, { langkah: number; tik: number; minNilai: number }> = {};
    for (const s of info.symbols) { const f = Object.fromEntries(s.filters.map((x: any) => [x.filterType, x]));
      aturanKoin[s.symbol] = { langkah: +f.LOT_SIZE.stepSize, tik: +f.PRICE_FILTER.tickSize, minNilai: +(f.MIN_NOTIONAL?.notional ?? 5) }; }
    const premi = Object.fromEntries((await ambil(`${FAPI}/fapi/v1/premiumIndex`)).map((x: any) => [x.symbol, { mark: +x.markPrice, funding: +x.lastFundingRate }]));
    const cache: Record<string, Lilin[]> = {};
    const bulat = (v: number, l: number) => Math.floor(v / l + 1e-9) * l, dp = (l: number) => Math.max(0, -Math.floor(Math.log10(l)));
    const liveSimbol = new Set<string>(); const perRobot: Record<string, number> = {}; let total = 0;

    for (const r of robot!) {
      const S = STRATEGI[r.strategi], kunciL = r.simbol + r.interval; cache[kunciL] ??= await lilin(r.simbol, r.interval); const k = cache[kunciL];
      const mark = premi[r.simbol]?.mark ?? k[k.length - 1].c, ctx: Ctx = { k, funding: premi[r.simbol]?.funding }, st = { transaksi: 0, menang: 0, kalah: 0, pnl: 0, puncak: +r.modal_awal, ddMaks: 0, ...(r.statistik || {}) };
      let kas = +r.kas, pos = r.posisi as any, status = r.status, live = !!r.live, catatan = r.catatan;
      const pakaiLive = live && bisaLive && !liveSimbol.has(r.simbol); if (live && !bisaLive) catatan = 'Saklar uang sungguhan nyala, tapi kunci Binance belum dipasang. Tetap simulasi.';
      if (live && liveSimbol.has(r.simbol)) catatan = `Koin ${r.simbol} sudah dipegang robot live lain. Robot ini tetap simulasi.`; if (pakaiLive) liveSimbol.add(r.simbol);
      const tutup = async (harga: number, alasan: string, olehBursa = false) => {
        let keluar = harga;
        if (pakaiLive && !olehBursa) { await batalSemua(AKUN_LIVE, r.simbol);
          const o = await bursa('POST', '/fapi/v1/order', { symbol: r.simbol, side: pos.sisi === 'long' ? 'SELL' : 'BUY', type: 'MARKET', quantity: pos.qty.toFixed(dp(aturanKoin[r.simbol].langkah)), reduceOnly: true, newOrderRespType: 'RESULT' });
          keluar = +o.avgPrice || harga; }
        else if (!pakaiLive) keluar = harga * (pos.sisi === 'long' ? 1 - SELIP : 1 + SELIP);
        if (pakaiLive && olehBursa) await batalSemua(AKUN_LIVE, r.simbol);   // order pengaman pasangannya (TP atau SL) jangan tertinggal
        const arah = pos.sisi === 'long' ? 1 : -1, kotor = (keluar - pos.masuk) * pos.qty * arah, biaya = (pos.masuk + keluar) * pos.qty * BIAYA, bersih = kotor - biaya;
        kas += bersih; st.transaksi++; bersih > 0 ? st.menang++ : st.kalah++; st.pnl += bersih;
        await db.from('lantai_transaksi').insert({ robot: r.id, data: { sisi: pos.sisi, masuk: pos.masuk, keluar, qty: pos.qty, pnl: +bersih.toFixed(4), biaya: +biaya.toFixed(4), alasanMasuk: pos.alasan, alasanKeluar: alasan, waktuMasuk: pos.waktu, waktuKeluar: kini.toISOString(), live: !!pos.live, simbol: r.simbol } });
        log.push(`${r.nama} tutup ${pos.sisi} ${r.simbol} ${bersih >= 0 ? '+' : ''}${bersih.toFixed(2)} (${alasan})`); pos = null; };

      try {
        // 1. posisi terbuka: stop loss / take profit pada lilin sesudah masuk, jejak, sinyal keluar, batas lama
        if (pos) {
          if (pakaiLive && pos.live) { const pr = (await bursa('GET', '/fapi/v2/positionRisk', { symbol: r.simbol }))[0]; if (pr && +pr.positionAmt === 0) await tutup(pos.sl, 'ditutup bursa (stop loss atau take profit)', true); }
          if (pos) for (const x of k.filter(x => x.t > Date.parse(pos.waktu))) {
            const kenaSl = pos.sisi === 'long' ? x.l <= pos.sl : x.h >= pos.sl, kenaTp = pos.tp != null && (pos.sisi === 'long' ? x.h >= pos.tp : x.l <= pos.tp);
            if (kenaSl) { await tutup(pos.sl, 'stop loss'); break; } if (kenaTp) { await tutup(pos.tp, 'take profit'); break; } }
          if (pos && S.jejak) { const g = S.jejak(ctx, pos.sisi); if (g != null && (pos.sisi === 'long' ? g > pos.sl : g < pos.sl)) pos.sl = g; }
          if (pos && S.keluar) { const a = S.keluar(ctx, pos.sisi); if (a) await tutup(mark, a); }
          if (pos && S.maksLilin && k.filter(x => x.t > Date.parse(pos.waktu)).length >= S.maksLilin) await tutup(mark, `sudah ${S.maksLilin} lilin`);
        }
        // 2. modal & batas rugi: dikeluarkan kalau modal (termasuk untung-rugi terbuka) di bawah batas
        const terbuka = pos ? (mark - pos.masuk) * pos.qty * (pos.sisi === 'long' ? 1 : -1) : 0; let modal = kas + terbuka;
        if (status === 'aktif' && modal <= +r.modal_awal * (1 - +r.batas_rugi)) { if (pos) await tutup(mark, 'batas rugi robot tersentuh'); modal = kas; status = 'dikeluarkan'; live = false;
          catatan = `Dikeluarkan ${kini.toISOString().slice(0, 16).replace('T', ' ')} UTC: modal ${modal.toFixed(2)} di bawah batas ${(+r.modal_awal * (1 - +r.batas_rugi)).toFixed(2)}.`; log.push(`${r.nama} DIKELUARKAN`); }
        st.puncak = Math.max(st.puncak, modal); st.ddMaks = Math.max(st.ddMaks, (st.puncak - modal) / st.puncak);
        // 3. masuk: hanya pada lilin tutup yang belum pernah dinilai
        const lilinAkhir = k[k.length - 1].t;
        if (!pos && status === 'aktif' && st.lilinDinilai !== lilinAkhir) {
          st.lilinDinilai = lilinAkhir; const s = S.masuk(ctx);
          if (s) { const A = aturanKoin[r.simbol], harga = mark * (s.sisi === 'long' ? 1 + SELIP : 1 - SELIP), jarak = Math.abs(harga - s.sl);
            let qty = jarak > 0 ? (kas * +r.risiko) / jarak : 0; qty = Math.min(qty, (kas * +r.leverage) / harga); qty = bulat(qty, A.langkah);
            const salahArah = s.sisi === 'long' ? s.sl >= harga : s.sl <= harga;
            if (salahArah) st.terakhirSinyal = { waktu: kini.toISOString(), teks: s.alasan + ' (dilewati: harga sudah melewati stop loss)' };
            else if (qty * harga < A.minNilai) st.terakhirSinyal = { waktu: kini.toISOString(), teks: `${s.alasan} (dilewati: nilai posisi ${(qty * harga).toFixed(2)} di bawah minimal Binance ${A.minNilai})` };
            else { let masuk = harga;
              if (pakaiLive) { await bursa('POST', '/fapi/v1/marginType', { symbol: r.simbol, marginType: 'ISOLATED' }).catch(() => null); await bursa('POST', '/fapi/v1/leverage', { symbol: r.simbol, leverage: +r.leverage });
                const o = await bursa('POST', '/fapi/v1/order', { symbol: r.simbol, side: s.sisi === 'long' ? 'BUY' : 'SELL', type: 'MARKET', quantity: qty.toFixed(dp(A.langkah)), newOrderRespType: 'RESULT' }); masuk = +o.avgPrice || mark;
                await pasangPengaman(AKUN_LIVE, r.simbol, s.sisi, s.sl, s.tp, A.tik); }
              pos = { sisi: s.sisi, masuk, qty, sl: s.sl, tp: s.tp, alasan: s.alasan, waktu: new Date(lilinAkhir).toISOString(), live: pakaiLive };
              st.terakhirSinyal = { waktu: kini.toISOString(), teks: s.alasan }; log.push(`${r.nama} buka ${s.sisi} ${r.simbol} di ${masuk} (${s.alasan})${pakaiLive ? ' LIVE' : ''}`); } }
        }
        const terbuka2 = pos ? (mark - pos.masuk) * pos.qty * (pos.sisi === 'long' ? 1 : -1) : 0;
        if (pos) pos.terbuka = +terbuka2.toFixed(4); modal = kas + terbuka2; perRobot[r.id] = +modal.toFixed(4); total += modal;
        st.mark = mark; st.aturan = S.aturan; st.judul = S.judul;
        await db.from('lantai_robot').update({ kas: +kas.toFixed(6), posisi: pos, status, live, catatan, statistik: st, diubah: kini.toISOString() }).eq('id', r.id);
      } catch (e) { log.push(`${r.nama}: ${String((e as Error).message || e).slice(0, 160)}`); await db.from('lantai_robot').update({ catatan: 'Galat putaran terakhir: ' + String((e as Error).message || e).slice(0, 200), diubah: kini.toISOString() }).eq('id', r.id); perRobot[r.id] = +r.kas; total += +r.kas; }
    }
    await db.from('lantai_modal').insert({ waktu: kini.toISOString(), total: +total.toFixed(4), per_robot: perRobot });
    return new Response(JSON.stringify({ ok: true, total: +total.toFixed(2), log }), { headers: { 'content-type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ ok: false, galat: String((e as Error).message || e), log }), { status: 500, headers: { 'content-type': 'application/json' } }); }
});
