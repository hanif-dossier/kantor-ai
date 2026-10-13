/* =====================================================================================================
   Kompleks Hanif (12 Okt 2026). Pemilik mengirim reel kompleks industri 3D malam hari (Heimdall Industries) dan
   memilih "bangun ulang jadi kompleks besar". Kota siang yang lama (bangunKota) diganti kampus malam: gedung tiap
   kelompok karyawan dengan jendela yang menyala menurut status kerja, gudang dengan pintu bongkar muat per karyawan,
   lab dengan ruas per karyawan, parkiran penuh mobil, deretan gudang, tangki, ladang surya, menara pendingin, gardu,
   lampu jalan dengan genangan cahaya, mobil berlampu yang lewat, cahaya berpendar (bloom), dan panel data gaya ruang
   kendali (unit kerja, log kegiatan, jam). Dipakai index.html lewat bangunKompleks(wadah); fungsi lain (keadaan,
   bukaGedung, bukaPanel, buatOrang, buatKit, bahan, warnaL, papanTeks, siapkanRender, GEDUNG, AGEN, DATA, T) milik
   index.html. Kota lama masih bisa dibuka dengan ?kota=lama.
   ===================================================================================================== */
// posisi tiap gedung di kompleks (gedung lain di GEDUNG tetap dipakai apa adanya: nama, karyawan, jenis)
const TATA_KOMPLEKS = {
  briefing: { x: -20, z: -15, bentuk: 'komando' }, pasar: { x: 20, z: -15, bentuk: 'menara' },
  usaha: { x: -50, z: -14, bentuk: 'gudang' }, galeri: { x: 50, z: -14 },
  studio: { x: -38, z: 14, bentuk: 'lab' }, kedai: { x: -10, z: 13 }, arkade: { x: 12, z: 14 }, kabar: { x: 40, z: 14, bentuk: 'siaran' } };

function bangunKompleks(wadah) {
  const lebar = wadah.clientWidth, tinggi = wadah.clientHeight, hp = lebar < 600;
  const renderer = new THREE.WebGLRenderer({ antialias: !hp, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, hp ? 1.4 : 1.75)); renderer.setSize(lebar, tinggi); wadah.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); siapkanRender(renderer, scene, true); renderer.toneMappingExposure = 1;
  // warna kabut dalam ruang linear: hasil akhir dikoreksi gamma oleh komposer, jadi kabut tetap gelap pekat
  scene.fog = new THREE.FogExp2(new THREE.Color('#070b14').convertSRGBToLinear(), hp ? .0055 : .006);
  const camera = new THREE.PerspectiveCamera(40, lebar / tinggi, .5, 4000);
  // 13 Okt 2026: langit, matahari, bayangan, dan kabut mengikuti jam WIB (langit.js); lampu kota hanya terang saat gelap
  const langit = buatLangit(scene, renderer, { hp });
  const lampuTitik = [[-20, 4, 0], [20, 4, 0], [0, 4, -15], [0, 4, 15], [-10, 3, 18]].map(([x, y, z]) => { const p = new THREE.PointLight(0xffc98a, 1.1, 26, 2); p.position.set(x, y, z); scene.add(p); return p; });

  const K = buatKit(scene), ps = K.pasang, kk = K.kk, y0 = .16, dapatDiketuk = [], kedip = [];
  const nyala = [], daftarNyala = (mat, jenis = 'lampu') => { mat.userData.n = mat.emissiveIntensity; mat.userData.jenis = jenis; nyala.push(mat); return mat; };   // bahan bercahaya, dikali faktor waktu
  let faktorJendela = 1;
  let benih = 7; const rnd = () => (benih = (benih * 16807) % 2147483647) / 2147483647;   // acak tetap: kompleks sama tiap dibuka
  // tekstur buatan: bintik halus (aspal, beton, rumput) dan ubin (plaza) supaya permukaan tidak rata seperti plastik
  const texBintik = (dasar, sebar, ulang, ubin = 0) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); x.fillStyle = dasar; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = (rnd() - .5) * sebar; x.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2); }
    if (ubin) { x.strokeStyle = 'rgba(0,0,0,.18)'; x.lineWidth = 2; for (let i = 0; i <= 256; i += 256 / ubin) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); } }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ulang, ulang); t.anisotropy = 4; return t; };
  const bahanTex = (tex, o = {}) => new THREE.MeshStandardMaterial({ map: tex, roughness: .9, ...o });
  const M = { tanah: bahanTex(texBintik('#6f8f4e', .22, 30)), aspal: bahanTex(texBintik('#3a3d42', .28, 40), { roughness: .85 }), marka: bahan(0xe8e4d8, { roughness: .6 }), trotoar: bahanTex(texBintik('#b9b4aa', .16, 60, 8)),
    plaza: bahanTex(texBintik('#cfc8bb', .12, 1, 6), { roughness: .75 }), pagarHidup: bahan(0x3f6a33, { roughness: .95 }), air: new THREE.MeshStandardMaterial({ color: warnaL(0x2c5a74), roughness: .04, metalness: .9 }),
    rumput: bahanTex(texBintik('#5d7f40', .25, 120)), daun: bahan(0x3d6b2c, { roughness: .9 }), daun2: bahan(0x557f35, { roughness: .9 }), daun3: bahan(0x2f5a2a, { roughness: .9 }), batang: bahan(0x5a4632, { roughness: .9 }),
    fasad: bahan(0x5d6672, { roughness: .45, metalness: .45 }), fasad2: bahan(0xd9d6cf, { roughness: .6, metalness: .05 }), beton: bahanTex(texBintik('#c3beb4', .14, 4)), atap: bahan(0x7b7f86, { roughness: .8, metalness: .2 }),
    sirip: bahan(0xe9e6df, { roughness: .45, metalness: .1 }), siripGelap: bahan(0x2a2f36, { roughness: .35, metalness: .6 }),
    kacaGelap: bahan(0x2c4256, { roughness: .05, metalness: .95 }), baja: bahan(0x3a3f46, { roughness: .35, metalness: .7 }), putih: bahan(0xeceae5, { roughness: .5 }), tangki: bahan(0xc9ced4, { roughness: .35, metalness: .55 }),
    surya: bahan(0x12203a, { roughness: .2, metalness: .7 }), lampu: bahan(0x222222, { emissive: 0xffd9a0, emissiveIntensity: 3.2 }), lampuDingin: bahan(0x222222, { emissive: 0xd8e6ff, emissiveIntensity: 2.6 }),
    jalurBiru: bahan(0x111111, { emissive: 0x5fb8ff, emissiveIntensity: 2.2 }), jalurHijau: bahan(0x111111, { emissive: 0x5fd08f, emissiveIntensity: 1.8 }) };
  [M.lampu, M.lampuDingin, M.jalurBiru, M.jalurHijau].forEach(m => daftarNyala(m));

  // ---------- tekstur buatan: jendela, genangan cahaya, teks berjalan
  const texJendela = (kol, bar, isi = .85) => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#04060a'; x.fillRect(0, 0, 256, 64);
    const cw = 256 / kol, ch = 64 / bar; for (let i = 0; i < kol; i++) for (let j = 0; j < bar; j++) { const v = rnd(); if (v > isi) continue; x.fillStyle = `rgba(255,${222 + (v * 30 | 0)},${168 + (v * 70 | 0)},${.35 + v * .65})`; x.fillRect(i * cw + cw * .14, j * ch + ch * .2, cw * .72, ch * .6); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = THREE.RepeatWrapping; return t; };
  const texBulat = (warna) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    // pudar halus (kira-kira kuadrat) supaya genangan tidak tampak seperti piring bertepi
    const a0 = +warna.match(/([\d.]+)\)$/)[1]; for (let i = 0; i <= 8; i++) { const t = i / 8; g.addColorStop(t, warna.replace(/[\d.]+\)$/, (a0 * (1 - t) * (1 - t)).toFixed(3) + ')')); } x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };
  const genangan = texBulat('rgba(255,165,80,0.3)'), pendar = texBulat('rgba(255,220,170,1)'), pendarMerah = texBulat('rgba(255,70,60,1)'), pendarPutih = texBulat('rgba(220,235,255,0.9)');
  const matGenangan = new THREE.MeshBasicMaterial({ map: genangan, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const geoDatar = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const kolamCahaya = []; const genang = (x, z, r) => kolamCahaya.push([x, z, r]);
  const pendarList = [];
  const sprite = (tex, s, x, y, z, induk = scene) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.scale.set(s, s, 1); m.position.set(x, y, z); induk.add(m); pendarList.push(m); return m; };
  const lampuMerah = (x, y, z) => { const m = new THREE.Mesh(K.GEO.b, bahan(0x220000, { emissive: 0xff2a1f, emissiveIntensity: 3 })); m.scale.setScalar(.35); m.position.set(x, y, z); scene.add(m); const s = sprite(pendarMerah, 2.2, x, y, z); kedip.push({ m, s, fase: rnd() * 6 }); };

  // ---------- bahan jendela per lantai: menyala menurut status karyawan
  const bahanDalam = tex => daftarNyala(new THREE.MeshStandardMaterial({ color: warnaL(0x6d8aa3), roughness: .04, metalness: .92, emissive: new THREE.Color(1, .93, .8), emissiveMap: tex, emissiveIntensity: .4 }), 'jendela');
  const bahanLed = () => new THREE.MeshStandardMaterial({ color: warnaL(0x111111), emissive: new THREE.Color(0, 0, 0), emissiveIntensity: 2.4 });
  const tambahMesh = (geo, mat, w, h, d, x, y, z, induk = scene) => { const m = new THREE.Mesh(geo, mat); m.scale.set(w, h, d); m.position.set(x, y, z); induk.add(m); return m; };
  // satu lantai berstatus: pita jendela + garis LED di bawahnya
  const sirip = (w, h, d, x, y, z, jarak = 1.6, mat = M.sirip) => { for (const [lw, ld, ox, oz, sumbu] of [[w, d, 0, d / 2, 'x'], [w, d, 0, -d / 2, 'x'], [d, w, w / 2, 0, 'z'], [d, w, -w / 2, 0, 'z']]) {
      const n = Math.max(2, Math.round(lw / jarak)); for (let i = 1; i < n; i++) { const t = -lw / 2 + i * lw / n; sumbu === 'x' ? ps('k', mat, .1, h, .28, x + t, y, z + oz + Math.sign(oz) * .1, 0, 0, true) : ps('k', mat, .28, h, .1, x + ox + Math.sign(ox) * .1, y, z + t, 0, 0, true); } } };
  const lantaiKotak = (w, h, d, x, y, z, kol = 14) => { const t = texJendela(kol, 2); t.repeat.set(Math.max(1, Math.round(w / 5)), 1); const dalam = bahanDalam(t), led = bahanLed();
    tambahMesh(K.GEO.k, dalam, w, h, d, x, y, z); tambahMesh(K.GEO.k, led, w + .14, .08, d + .14, x, y - h / 2 + .05, z); sirip(w, h, d, x, y, z); return { dalam, led }; };
  const geoTabung = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  const lantaiTabung = (r, h, x, y, z) => { const t = texJendela(22, 2); t.repeat.set(3, 1); const dalam = bahanDalam(t), led = bahanLed();
    tambahMesh(geoTabung, dalam, r, h, r, x, y, z); tambahMesh(K.GEO.s, led, r * 2 + .3, .08, r * 2 + .3, x, y - h / 2 + .05, z);
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; ps('k', M.sirip, .12, h, .32, x + Math.cos(a) * (r + .12), y, z + Math.sin(a) * (r + .12), -a, 0, true); }
    return { dalam, led }; };
  // lantai hiasan (bukan karyawan): nyala tetap, beda-beda tiap lantai
  const lantaiHias = (w, h, d, x, y, z) => { const t = texJendela(14, 2, .55); t.repeat.set(Math.max(1, Math.round(w / 5)), 1); const m = bahanDalam(t); m.emissiveIntensity = m.userData.n = .55 + rnd() * .5; tambahMesh(K.GEO.k, m, w, h, d, x, y, z); if (w > 1 && d > 1) sirip(w, h, d, x, y, z); };
  const WARNA_JENDELA = { kerja: [new THREE.Color(1, .93, .8), 2.6], selesai: [new THREE.Color(1, .82, .45), 1.7], gagal: [new THREE.Color(1, .38, .3), 2], istirahat: [new THREE.Color(.75, .82, 1), .38], kosong: [new THREE.Color(.75, .82, 1), .14] };
  const aturLantai = (L, st) => { const [c, n] = WARNA_JENDELA[st] || WARNA_JENDELA.istirahat; L.dalam.emissive.copy(c); L.dalam.userData.n = n; L.dalam.emissiveIntensity = n * faktorJendela;
    L.led.emissive.copy(st === 'kerja' || st === 'selesai' || st === 'gagal' ? warnaL(WARNA_ST[st]) : new THREE.Color(.05, .07, .1)); };

  const tak = (grp, w, h, d, x = 0, z = 0) => { const m = new THREE.Mesh(K.GEO.k, new THREE.MeshBasicMaterial({ visible: false })); m.scale.set(w, h, d); m.position.set(x, h / 2, z); grp.add(m);
    // plaza berubin di sekeliling gedung + pagar tanaman di dua sisi + pohon di sudut
    const X = grp.position.x + x, Z = grp.position.z + z, pw = w + 7, pd = d + 7, pl = new THREE.Mesh(K.GEO.k, M.plaza.clone()); pl.material.map = M.plaza.map.clone(); pl.material.map.needsUpdate = true; pl.material.map.repeat.set(pw / 4, pd / 4);
    pl.scale.set(pw, .06, pd); pl.position.set(X, y0 + .02, Z);   // di bawah permukaan jalan supaya jalan tetap terlihat pl.receiveShadow = true; scene.add(pl);
    [-1, 1].forEach(s => { kk(M.pagarHidup, .9, .8, pd - 4, X + s * (pw / 2 - .6), y0 + .45, Z); [-1, 1].forEach(t => pohon(X + s * (pw / 2 - 1.4), Z + t * (pd / 2 - 1.4), .75)); }); };
  const papan = (teks, w, h, x, y, z, induk, latar = '#0d1117', tinta = '#e9c886', ry = 0) => { const p = papanTeks(teks, latar, tinta, w, h); p.position.set(x, y, z); p.rotation.y = ry; induk.add(p); return p; };
  const grupGedung = g => { const grp = new THREE.Group(); grp.position.set(g.x, 0, g.z); grp.userData.gedung = g; scene.add(grp); g.grup = grp; dapatDiketuk.push(grp); return grp; };
  // pohon tropis: batang + tajuk dari beberapa gumpalan daun dengan hijau yang berbeda
  const pohon = (x, z, s = 1) => { const D = [M.daun, M.daun2, M.daun3]; ps('s', M.batang, .22 * s, 2 * s, .22 * s, x, y0 + 1 * s, z);
    ps('b', D[(rnd() * 3) | 0], 2.6 * s, 2.2 * s, 2.6 * s, x, y0 + 2.6 * s, z); for (let i = 0; i < 3; i++) { const a = rnd() * 6.28, r = .7 * s; ps('b', D[(rnd() * 3) | 0], 1.7 * s, 1.5 * s, 1.7 * s, x + Math.cos(a) * r, y0 + (2.3 + rnd() * .9) * s, z + Math.sin(a) * r); } };

  // ---------- tanah, jalan, trotoar, marka
  tambahMesh(K.GEO.k, M.rumput, 700, .2, 700, 0, -.3, 0);
  kk(M.tanah, 150, .3, 110, 0, 0, 0, 0, false);
  const jalan = (x, z, w, d) => { kk(M.aspal, w, .06, d, x, y0 + .03, z, 0, false); };
  const garisPutus = (x1, z1, x2, z2) => { const n = Math.floor(Math.hypot(x2 - x1, z2 - z1) / 4); for (let i = 0; i < n; i++) { const t = (i + .5) / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t; kk(M.marka, x1 === x2 ? .14 : 1.8, .02, x1 === x2 ? 1.8 : .14, x, y0 + .07, z, 0, false); } };
  // jalan utama timur-barat dan utara-selatan, jalan pembagi, dan jalan keliling
  jalan(0, 0, 150, 7); jalan(0, 0, 7, 110); jalan(0, -29, 150, 5); jalan(0, 28, 150, 5); jalan(-30, 0, 5, 110); jalan(30, 0, 5, 110); jalan(-72, 0, 5, 110); jalan(72, 0, 5, 110);
  garisPutus(-74, 0, 74, 0); garisPutus(0, -54, 0, 54);
  // trotoar di tepi jalan utama
  [-4.1, 4.1].forEach(o => { kk(M.trotoar, 150, .14, 1.2, 0, y0 + .07, o, 0, false); kk(M.trotoar, 1.2, .14, 110, o, y0 + .07, 0, 0, false); });
  // penyeberangan di simpang tengah
  for (let i = -3; i <= 3; i++) { kk(M.marka, .5, .02, 2.2, i * .9, y0 + .08, 5.6, 0, false); kk(M.marka, .5, .02, 2.2, i * .9, y0 + .08, -5.6, 0, false); kk(M.marka, 2.2, .02, .5, 5.6, y0 + .08, i * .9, 0, false); kk(M.marka, 2.2, .02, .5, -5.6, y0 + .08, i * .9, 0, false); }
  // lampu jalan: tiang, kepala menyala, pendar, dan genangan cahaya di aspal
  const lampuJalan = (x, z, ax, az) => { ps('s', M.baja, .12, 4.4, .12, x, y0 + 2.2, z); kk(M.baja, ax ? 1.2 : .1, .08, az ? 1.2 : .1, x + ax * .55, y0 + 4.35, z + az * .55); kk(M.lampu, ax ? .5 : .24, .07, az ? .5 : .24, x + ax * 1.05, y0 + 4.29, z + az * 1.05, 0, false);
    sprite(pendar, 1.4, x + ax * 1.05, y0 + 4.2, z + az * 1.05); genang(x + ax * 1.4, z + az * 1.4, 6); };
  for (let x = -66; x <= 66; x += 14) { if (Math.abs(x) < 6) continue; lampuJalan(x, -4.4, 0, 1); lampuJalan(x + 7, 4.4, 0, -1); }
  for (let z = -50; z <= 50; z += 14) { if (Math.abs(z) < 6) continue; lampuJalan(-4.4, z, 1, 0); lampuJalan(4.4, z + 7, -1, 0); }
  [-29, 28].forEach(z => { for (let x = -62; x <= 62; x += 24) lampuJalan(x, z - 3, 0, 1); });
  // pagar keliling dan gerbang selatan
  const pagar = (x1, z1, x2, z2) => { const n = Math.floor(Math.hypot(x2 - x1, z2 - z1) / 3); for (let i = 0; i <= n; i++) { const t = i / n; ps('s', M.baja, .08, 2, .08, x1 + (x2 - x1) * t, y0 + 1, z1 + (z2 - z1) * t); }
    kk(M.baja, Math.abs(x2 - x1) || .05, .06, Math.abs(z2 - z1) || .05, (x1 + x2) / 2, y0 + 1.9, (z1 + z2) / 2, 0, false); kk(M.baja, Math.abs(x2 - x1) || .05, .06, Math.abs(z2 - z1) || .05, (x1 + x2) / 2, y0 + 1.1, (z1 + z2) / 2, 0, false); };
  pagar(-75, -55, 75, -55); pagar(-75, -55, -75, 55); pagar(75, -55, 75, 55); pagar(-75, 55, -6, 55); pagar(6, 55, 75, 55);
  kk(M.fasad2, 3, 2.6, 3, 7.5, y0 + 1.3, 53); kk(M.lampuDingin, 2.2, .7, .05, 7.5, y0 + 1.8, 54.53, 0, false); kk(M.baja, 12, .5, .5, 0, y0 + 4, 55); [-6, 6].forEach(x => ps('s', M.baja, .5, 4, .5, x, y0 + 2, 55));
  papan('KOMPLEKS HANIF', 7, .55, 0, y0 + 4, 55.3, scene, '#0b0f16', '#f3c550');

  // ---------- gedung karyawan
  function komando(g) { const X = g.x, Z = g.z, grp = grupGedung(g), n = g.agen.length, h = 2.8, r = 4.2;
    kk(M.fasad, 15, 1.8, 12, X, y0 + .9, Z); kk(M.lampuDingin, 13, .5, .06, X, y0 + 1.2, Z + 6.03, 0, false); kk(M.fasad2, 15.4, .2, 12.4, X, y0 + 1.9, Z);
    g.lantai = []; let y = y0 + 2;
    for (let i = 0; i < n; i++) { g.lantai.push(lantaiTabung(r, h - .3, X, y + h / 2, Z)); ps('s', M.fasad2, r * 2 + .5, .3, r * 2 + .5, X, y + h, Z); y += h; }
    for (let i = 0; i < 2; i++) { const t = texJendela(22, 2, .5); t.repeat.set(3, 1); const m = bahanDalam(t); m.emissiveIntensity = .7; tambahMesh(geoTabung, m, r - .4, h - .3, r - .4, X, y + h / 2, Z); ps('s', M.fasad2, r * 2 - .3, .3, r * 2 - .3, X, y + h, Z); y += h; }
    // helipad di atap, lampu tepi, tiang antena berkedip
    ps('s', M.atap, r * 2, .3, r * 2, X, y + .2, Z); kk(M.marka, .35, .02, 2.2, X - .6, y + .37, Z, 0, false); kk(M.marka, .35, .02, 2.2, X + .6, y + .37, Z, 0, false); kk(M.marka, 1.2, .02, .3, X, y + .37, Z, 0, false);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ps('b', M.jalurHijau, .16, .16, .16, X + Math.cos(a) * (r - .4), y + .42, Z + Math.sin(a) * (r - .4), 0, 0, false); }
    ps('s', M.baja, .14, 6, .14, X + r - 1, y + 3, Z - 1); lampuMerah(X + r - 1, y + 6.1, Z - 1);
    papan('PUSAT KOMANDO', 6, .6, 0, y0 + 2.4, 6.05, grp, '#0b0f16', '#9fd4ff');
    kk(M.beton, 12.6, .3, 3.2, X, y0 + .15, Z + 9.6); tambahMesh(K.GEO.k, M.air, 12, .1, 2.6, X, y0 + .27, Z + 9.6);
    g.puncak = y + 1; tak(grp, 15, y + 1, 12); }
  function menara(g) { const X = g.x, Z = g.z, grp = grupGedung(g), n = g.agen.length, h = 3, w = 8;
    kk(M.kacaGelap, 13, 3, 11, X, y0 + 1.5, Z); kk(M.lampu, 11, .6, .06, X, y0 + 1.4, Z + 5.53, 0, false); kk(M.fasad2, 13.4, .25, 11.4, X, y0 + 3.1, Z);
    g.lantai = []; let y = y0 + 3.2;
    for (let i = 0; i < n; i++) { g.lantai.push(lantaiKotak(w, h - .3, w, X, y + h / 2, Z, 12)); kk(M.fasad, w + .5, .3, w + .5, X, y + h, Z); y += h; }
    for (let i = 0; i < 4; i++) { lantaiHias(w - .4 - i * .3, h - .3, w - .4 - i * .3, X, y + h / 2, Z); kk(M.fasad, w + .1 - i * .3, .3, w + .1 - i * .3, X, y + h, Z); y += h; }
    // mahkota: pita teks berjalan + menara ujung
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#020409'; x.fillRect(0, 0, 1024, 64); x.font = 'bold 40px "Plus Jakarta Sans", sans-serif'; x.fillStyle = '#6fe3ff'; x.textBaseline = 'middle';
    x.fillText('MENARA PASAR  ·  BRIEFING 06.00  ·  RADAR PORTOFOLIO  ·  SCREENING ALTCOIN  ·  ', 12, 34);
    const pita = new THREE.CanvasTexture(c); pita.encoding = THREE.sRGBEncoding; pita.wrapS = THREE.RepeatWrapping; pita.repeat.set(1.2, 1); T_pita = pita;
    tambahMesh(K.GEO.k, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 1, 1), emissiveMap: pita, emissiveIntensity: 1.8 }), w - 1.2, 1, w - 1.2, X, y + .6, Z);
    kk(M.fasad, w - .8, .25, w - .8, X, y + 1.2, Z); ps('c', M.baja, 1.4, 7, 1.4, X, y + 4.8, Z); lampuMerah(X, y + 8.5, Z);
    g.puncak = y + 2; tak(grp, 13, y + 2, 11); }
  function gudang(g) { const X = g.x, Z = g.z, grp = grupGedung(g), n = g.agen.length, w = 24, d = 13, h = 7;
    kk(M.beton, w, h, d, X, y0 + h / 2, Z); kk(M.fasad2, w + .3, .4, d + .3, X, y0 + h, Z);
    for (let i = 0; i < 6; i++) { const x = X - w / 2 + 2 + i * 4; kk(M.atap, 3.6, .3, d - 1, x, y0 + h + .9, Z - .4, 0, true); kk(M.lampuDingin, 3.4, .9, .05, x, y0 + h + .55, Z + d / 2 - 1.2, 0, false); }
    // pintu bongkar muat: satu pintu satu karyawan, menyala sesuai status
    g.lantai = []; for (let i = 0; i < n; i++) { const x = X - w / 2 + 3.5 + i * ((w - 7) / Math.max(1, n - 1)); const L = { dalam: new THREE.MeshStandardMaterial({ color: warnaL(0x0a0d12), emissive: new THREE.Color(1, .9, .7), emissiveIntensity: .4 }), led: bahanLed() };
      tambahMesh(K.GEO.k, L.dalam, 3.4, 3.8, .1, x, y0 + 1.9, Z + d / 2 + .02); tambahMesh(K.GEO.k, L.led, 3.8, .14, .2, x, y0 + 4.05, Z + d / 2 + .08);
      kk(M.baja, 4.4, .12, 1.8, x, y0 + 4.4, Z + d / 2 + .9); kk(M.beton, 3.8, 1.1, 1.2, x, y0 + .55, Z + d / 2 + .6); genang(x, Z + d / 2 + 2.6, 5); g.lantai.push(L); }
    // kantor kecil di ujung gudang dan truk yang sedang bongkar
    lantaiHias(5, 2.4, 5.5, X + w / 2 + 2.6, y0 + 1.3, Z + 3); lantaiHias(5, 2.4, 5.5, X + w / 2 + 2.6, y0 + 3.8, Z + 3); kk(M.fasad, 5.4, .3, 5.9, X + w / 2 + 2.6, y0 + 5.1, Z + 3);
    truk(X - w / 2 + 3.5, Z + d / 2 + 5.4, Math.PI / 2); truk(X - w / 2 + 3.5 + (w - 7) / 3 * 2, Z + d / 2 + 5.4, Math.PI / 2);
    papan('GUDANG OFU & NTA', 7.5, .7, 0, y0 + h - 1, d / 2 + .05, grp, '#0b0f16', '#f3c550');
    g.puncak = h + 2; tak(grp, w + 6, h + 1, d + 6); }
  function lab(g) { const X = g.x, Z = g.z, grp = grupGedung(g), n = g.agen.length, w = 30, d = 12, h = 6.4;
    kk(M.fasad, w + .6, .5, d + .6, X, y0 + .25, Z);
    // satu ruas satu karyawan: pita jendela dua lantai di muka depan dan belakang
    g.lantai = []; const ruas = w / n; for (let i = 0; i < n; i++) { const x = X - w / 2 + ruas * (i + .5); const L = lantaiKotak(ruas - .4, h - .6, d, x, y0 + .5 + (h - .6) / 2, Z, 10); g.lantai.push(L); kk(M.fasad2, .4, h, d + .3, x + ruas / 2, y0 + .5 + h / 2, Z); }
    kk(M.fasad2, .4, h, d + .3, X - w / 2, y0 + .5 + h / 2, Z); kk(M.fasad, w + .6, .2, d + .6, X, y0 + .5 + h / 2, Z); kk(M.atap, w + .8, .4, d + .8, X, y0 + h + .6, Z);
    // atap: unit pendingin, cerobong berlampu, lajur ruang bersih
    for (let i = 0; i < 6; i++) { kk(M.tangki, 2.2, 1.2, 2.2, X - w / 2 + 3 + i * 4.8, y0 + h + 1.4, Z - 3); ps('s', M.baja, 1.6, .2, 1.6, X - w / 2 + 3 + i * 4.8, y0 + h + 2.05, Z - 3); }
    kk(M.jalurBiru, w - 4, .1, .6, X, y0 + h + .85, Z + 2.5, 0, false);
    [[-w / 2 + 2, 3.5], [w / 2 - 2, 3.5]].forEach(([dx, dz]) => { ps('s', M.beton, .9, 5, .9, X + dx, y0 + h + 3.3, Z + dz); lampuMerah(X + dx, y0 + h + 5.9, Z + dz); });
    papan('LAB CLAUDE CODE', 7, .7, 0, y0 + h + 1.3, d / 2 + .45, grp, '#0b0f16', '#9fd4ff');
    g.puncak = h + 3; tak(grp, w, h + 1, d); }
  function siaran(g) { const X = g.x, Z = g.z, grp = grupGedung(g), n = g.agen.length, h = 2.8, w = 11, d = 9;
    kk(M.fasad, w + 2, 1.6, d + 2, X, y0 + .8, Z); kk(M.lampu, w, .5, .06, X, y0 + 1, Z + d / 2 + 1.03, 0, false);
    g.lantai = []; let y = y0 + 1.6; for (let i = 0; i < n; i++) { g.lantai.push(lantaiKotak(w, h - .3, d, X, y + h / 2, Z, 12)); kk(M.fasad2, w + .4, .3, d + .4, X, y + h, Z); y += h; }
    kk(M.atap, w + .4, .3, d + .4, X, y + .15, Z);
    // parabola di atap dan menara pemancar
    [[-3, -2], [0, 2], [3, -1.5]].forEach(([dx, dz], i) => { ps('s', M.baja, .3, 1.2, .3, X + dx, y + .9, Z + dz); const p = new THREE.Mesh(new THREE.SphereGeometry(1.4, 18, 8, 0, Math.PI * 2, 0, Math.PI * .32), M.putih);
      p.position.set(X + dx, y + 1.9, Z + dz); p.rotation.set(-.9, i * 1.4, 0); scene.add(p); });
    const mx = X + w / 2 - 1.5, mz = Z - d / 2 + 1.5, tinggiM = 12; [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]].forEach(([a, b]) => ps('s', M.baja, .1, tinggiM, .1, mx + a, y + tinggiM / 2, mz + b));
    for (let k = 1; k < 8; k++) kk(M.baja, 1.3, .06, 1.3, mx, y + k * 1.5, mz, 0, false); lampuMerah(mx, y + tinggiM + .3, mz); lampuMerah(mx, y + tinggiM / 2, mz + .7);
    papan('MENARA SIARAN', 5.5, .55, 0, y0 + 1.3, d / 2 + 1.05, grp, '#0b0f16', '#f3c550');
    g.puncak = y + 2; tak(grp, w + 2, y + 2, d + 2); }
  // ---------- kedai, arkade, galeri
  function kedai(g) { const X = g.x, Z = g.z, grp = grupGedung(g);
    kk(M.trotoar, 12, .2, 10, X, y0 + .1, Z, 0, false); kk(M.fasad2, 7, 3.2, 4.4, X, y0 + 1.8, Z - 2.4);
    tambahMesh(K.GEO.k, bahan(0x1a0f08, { emissive: 0xffb36b, emissiveIntensity: 1.8 }), 6.2, 2.2, .06, X, y0 + 1.6, Z - .17); kk(M.atap, 8, .2, 6, X, y0 + 3.5, Z - 1.6);
    for (let i = 0; i < 14; i++) ps('b', M.lampu, .14, .14, .14, X - 5 + i * .77, y0 + 3.1 - Math.sin(i / 13 * Math.PI) * .4, Z + 1.4, 0, 0, false);
    g.kursi = []; [[-3, 2.6], [0, 2.6], [3, 2.6], [-3, 4.4], [0, 4.4], [3, 4.4]].forEach(([x, z], i) => { kk(M.beton, 1.1, .08, 1.1, X + x, y0 + .9, Z + z + (i < 3 ? .9 : -.9)); ps('s', M.baja, .1, .9, .1, X + x, y0 + .45, Z + z + (i < 3 ? .9 : -.9)); g.kursi.push([x, z, i < 3 ? 2 : 0]); });
    genang(X, Z + 3.4, 9); papan('KEDAI KOPI', 4, .6, 0, y0 + 3.2, -.15, grp, '#1a0f08', '#ffd29a');
    g.orang = {}; g.puncak = 4.4; tak(grp, 12, 4, 10); }
  function arkade(g) { const X = g.x, Z = g.z, grp = grupGedung(g);
    ps('s', M.fasad, 11, 2.4, 11, X, y0 + 1.2, Z); const kubah = new THREE.Mesh(new THREE.SphereGeometry(4.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), bahan(0x1a1430, { roughness: .2, metalness: .6 })); kubah.position.set(X, y0 + 2.4, Z); scene.add(kubah);
    [[5.6, .9, 0xff4fd8], [4.75, 2.6, 0x5fe3ff], [3.6, 4.6, 0xff4fd8]].forEach(([r, y, c]) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, .08, 8, 64), bahan(0x000000, { emissive: c, emissiveIntensity: 2.6 })); t.rotation.x = Math.PI / 2; t.position.set(X, y0 + y, Z); scene.add(t); });
    papan('ARKADE', 3.6, .8, 0, y0 + 1.5, 5.55, grp, '#12081f', '#ff7fe0');
    g.lampuKecil = []; for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, m = new THREE.Mesh(K.GEO.b, bahan(0x000000, { emissive: i % 2 ? 0xff4fd8 : 0x5fe3ff, emissiveIntensity: 2 })); m.scale.setScalar(.3); m.position.set(Math.cos(a) * 6.4, y0 + .3, Math.sin(a) * 6.4); grp.add(m); g.lampuKecil.push(m); }
    genang(X, Z + 7, 9); g.puncak = 7.4; tak(grp, 12, 7, 12); }
  function galeri(g) { const X = g.x, Z = g.z, grp = grupGedung(g);
    kk(M.putih, 13, .4, 10, X, y0 + .2, Z); tambahMesh(K.GEO.k, new THREE.MeshStandardMaterial({ color: warnaL(0x9fc6e0), roughness: .05, metalness: .3, transparent: true, opacity: .22, depthWrite: false }), 11, 3.6, 8, X, y0 + 2.2, Z);
    kk(M.putih, 13.4, .3, 10.4, X, y0 + 4.15, Z); [[-5.5, -4], [5.5, -4], [-5.5, 4], [5.5, 4]].forEach(([x, z]) => kk(M.baja, .12, 3.7, .12, X + x, y0 + 2.2, Z + z));
    tambahMesh(K.GEO.k, bahan(0x0a1820, { emissive: 0x2a9cc0, emissiveIntensity: 1.2 }), 9, .05, 1.6, X, y0 + .05, Z + 6.2);
    g.pajangan = [[-2.6, -1.5, 0x6fb6ff], [2.6, -1.5, 0x6fb6ff], [-2.6, 1.8, 0xf3c550], [2.6, 1.8, 0xf3c550]].map(([x, z, c]) => { kk(M.putih, .9, 1, .9, X + x, y0 + .9, Z + z);
      const m = new THREE.Mesh(K.GEO.k, bahan(0x111111, { emissive: c, emissiveIntensity: 1.6, roughness: .2, metalness: .5 })); m.scale.setScalar(.6); m.position.set(x, y0 + 1.9, z); grp.add(m); return m; });
    papan('GALERI WEB2 & WEB3', 6, .5, 0, y0 + 4.15, 5.25, grp, '#0b0f16', '#e9c886');
    g.puncak = 5.2; tak(grp, 13, 4.4, 10); }
  // ---------- kendaraan diam (truk di gudang, mobil di parkiran)
  function truk(x, z, ry) { const grp = new THREE.Group(); grp.position.set(x, y0, z); grp.rotation.y = ry; scene.add(grp);
    tambahMesh(K.GEO.k, M.putih, 6, 2.6, 2.3, -1, 1.7, 0, grp); tambahMesh(K.GEO.k, bahan(0x2b4a7a, { roughness: .4, metalness: .4 }), 2, 2.2, 2.3, 3.1, 1.5, 0, grp); tambahMesh(K.GEO.k, M.kacaGelap, .05, .9, 2, 4.12, 2.1, 0, grp);
    [-.6, 1].forEach(z2 => tambahMesh(K.GEO.k, bahan(0x222222, { emissive: 0xfff2d6, emissiveIntensity: 2 }), .05, .2, .3, 4.13, .9, z2 - .2, grp)); }
  const CAT = [0xb3202a, 0x1f4f9a, 0xd8d6d0, 0x22252b, 0x8f99a4, 0x2f6b5a, 0x6b6f76, 0x9a7b3a];
  function parkiran(cx, cz, kol, bar) { const w = kol * 2.8 + 2, d = bar * 6.4; kk(M.aspal, w, .05, d, cx, y0 + .04, cz, 0, false);
    const n = kol * bar, badan = new THREE.InstancedMesh(K.GEO.k, new THREE.MeshStandardMaterial({ roughness: .3, metalness: .6 }), n), kabin = new THREE.InstancedMesh(K.GEO.k, M.kacaGelap, n), o = new THREE.Object3D(); let i = 0;
    for (let b = 0; b < bar; b++) for (let k = 0; k < kol; k++) { const x = cx - w / 2 + 2.4 + k * 2.8, z = cz - d / 2 + 3.2 + b * 6.4; kk(M.marka, .1, .02, 4.4, x - 1.4, y0 + .08, z, 0, false);
      if (rnd() < .2) continue; const balik = b % 2 ? Math.PI : 0;
      o.position.set(x, y0 + .45, z); o.rotation.set(0, Math.PI / 2 + balik, 0); o.scale.set(3.8, .7, 1.7); o.updateMatrix(); badan.setMatrixAt(i, o.matrix); badan.setColorAt(i, warnaL(CAT[(rnd() * CAT.length) | 0]));
      o.position.set(x, y0 + 1.05, z + (balik ? .25 : -.25)); o.scale.set(2, .55, 1.5); o.updateMatrix(); kabin.setMatrixAt(i, o.matrix); i++; }
    badan.count = kabin.count = i; scene.add(badan, kabin);
    for (let k = 2; k < kol; k += 6) { lampuJalan(cx - w / 2 + 2 + k * 2.8, cz, 0, 0); } }
  // ---------- isian kawasan industri (bukan gedung karyawan)
  function gudangHias(x, z, w, d, h) { kk(M.fasad2, w, h, d, x, y0 + h / 2, z); kk(M.atap, w + .3, .3, d + .3, x, y0 + h, z);
    for (let i = 0; i < Math.floor(w / 4); i++) { const px = x - w / 2 + 2 + i * 4; kk(M.lampuDingin, 2.6, .25, .05, px, y0 + h - 1.2, z + d / 2 + .03, 0, false); if (rnd() > .5) { kk(M.baja, 1.2, .8, 1.2, px, y0 + h + .55, z); } }
    if (rnd() > .4) lantaiHias(w * .3, 2, .2, x - w * .25, y0 + 1.6, z + d / 2 + .1); genang(x, z + d / 2 + 2, 7); }
  function tangki(x, z) { ps('s', M.tangki, 4.4, 6, 4.4, x, y0 + 3, z); ps('b', M.tangki, 4.4, 1.6, 4.4, x, y0 + 6, z); ps('s', M.baja, 4.6, .12, 4.6, x, y0 + 4.4, z); lampuMerah(x, y0 + 6.9, z); }
  function menaraDingin(x, z) { const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(4.6 - Math.sin(t * Math.PI) * 1.6 - t * .8, t * 14)); }
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), bahan(0x6c727b, { roughness: .9, side: THREE.DoubleSide })); m.position.set(x, y0, z); scene.add(m); lampuMerah(x + 3.2, y0 + 14.2, z); }
  // susunan kawasan
  [-56, -32, -8, 16, 40].forEach((x, i) => gudangHias(x + 6, -42, 18 + (i % 2) * 4, 12, 6 + (i % 3)));
  [[48, 38], [56, 38], [64, 38], [48, 46], [56, 46], [64, 46]].forEach(([x, z]) => tangki(x, z - 4));
  for (let b = 0; b < 6; b++) for (let k = 0; k < 9; k++) ps('k', M.surya, 2.4, .08, 1.5, -64 + k * 2.8, y0 + .9, 36 + b * 2.6, 0, -.45, false);
  for (let b = 0; b < 6; b++) for (let k = 0; k < 9; k++) ps('s', M.baja, .06, .9, .06, -64 + k * 2.8, y0 + .45, 36 + b * 2.6);
  menaraDingin(62, -22); menaraDingin(62, -8);
  // gardu listrik + tiang transmisi
  for (let i = 0; i < 6; i++) kk(M.tangki, 1.6, 2, 1.4, -66 + (i % 3) * 3, y0 + 1, 22 + Math.floor(i / 3) * 3);
  [[-66, 12], [-66, -12], [-66, -36]].forEach(([x, z]) => { ps('c', M.baja, 1.4, 14, 1.4, x, y0 + 7, z); kk(M.baja, 5, .15, .15, x, y0 + 12, z, 0, false); lampuMerah(x, y0 + 14.2, z); });
  // menara air
  ps('s', M.tangki, 4, 3, 4, 30, y0 + 13, -40); [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].forEach(([a, b]) => ps('s', M.baja, .2, 11.5, .2, 30 + a, y0 + 5.75, -40 + b)); lampuMerah(30, y0 + 14.8, -40);
  parkiran(-10, 40, 16, 2); parkiran(24, 40, 7, 2); 
  // pepohonan di tepi jalan dan sabuk hutan di luar pagar
  for (let x = -66; x <= 66; x += 6) { if (Math.abs(x) < 8) continue; pohon(x + 2, 8.5, .8); pohon(x, -8.5, .8); }
  for (let i = 0; i < 260; i++) { const a = rnd() * Math.PI * 2, r = 92 + rnd() * 90, x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r * .9; pohon(x, z, 1.1 + rnd() * 1.4); }
  for (let i = 0; i < 26; i++) pohon(-74 + rnd() * 148, 52 + rnd() * 1.5, .9);

  // ---------- bangun gedung karyawan dari GEDUNG
  const BENTUK = { komando, menara, gudang, lab, siaran };
  let T_pita = null;
  for (const g of GEDUNG) { const t = TATA_KOMPLEKS[g.id]; if (!t) continue; g.x = t.x; g.z = t.z;
    if (g.jenis === 'kedai') kedai(g); else if (g.jenis === 'arkade') arkade(g); else if (g.jenis === 'galeri') galeri(g); else if (g.jenis === 'taman') continue; else (BENTUK[t.bentuk] || menara)(g); }
  K.rakit();
  scene.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.isSprite && o.material && !o.material.transparent && o.material.visible !== false && !(o.material.isMeshBasicMaterial)) { o.receiveShadow = true; if (o.geometry !== geoDatar && o.scale.y > .25) o.castShadow = true; } });
  [M.tanah, M.rumput, M.aspal, M.trotoar].forEach(m => m.needsUpdate = true);
  // pantulan langit: kuat di kaca dan air, tipis di permukaan lain
  scene.traverse(o => { const m = o.material; if (m && m.isMeshStandardMaterial && m.userData.jenis !== 'jendela' && m !== M.air && m !== M.kacaGelap) m.envMapIntensity = .45; });
  // genangan cahaya lampu jadi satu InstancedMesh
  { const im = new THREE.InstancedMesh(geoDatar, matGenangan, kolamCahaya.length), o = new THREE.Object3D();
    kolamCahaya.forEach(([x, z, r], i) => { o.position.set(x, y0 + .09, z); o.scale.set(r, 1, r); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.renderOrder = 2; scene.add(im); }

  // ---------- mobil yang lewat: lampu depan putih, lampu belakang merah, sorot di aspal
  const lampuD = daftarNyala(bahan(0x222222, { emissive: 0xfff4d6, emissiveIntensity: 3 })), lampuB = daftarNyala(bahan(0x220000, { emissive: 0xff2a2a, emissiveIntensity: 2.4 })), ban = bahan(0x0d0d0d, { roughness: .9 });
  const sorot = new THREE.MeshBasicMaterial({ map: texBulat('rgba(255,240,210,0.6)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const LAJUR = [[1, 0, 1.7], [-1, 0, -1.7], [0, 1, -1.7], [0, -1, 1.7], [1, 0, 1.7], [-1, 0, -1.7], [0, 1, -1.7], [1, 0, 1.7], [-1, 0, -1.7], [0, -1, 1.7]];
  const mobil = LAJUR.map(([dx, dz, o], i) => { const grp = new THREE.Group(), cat = bahan(CAT[i % CAT.length], { roughness: .25, metalness: .65 }), kb = (m, w, h, d, x, y, z) => tambahMesh(K.GEO.k, m, w, h, d, x, y, z, grp);
    kb(cat, 3.8, .7, 1.7, 0, .55, 0); kb(M.kacaGelap, 2, .55, 1.5, -.25, 1.15, 0); [[-1.2, .8], [1.2, .8], [-1.2, -.8], [1.2, -.8]].forEach(([x, z]) => kb(ban, .6, .6, .2, x, .3, z));
    [-.55, .55].forEach(z => { kb(lampuD, .05, .14, .3, 1.92, .62, z); kb(lampuB, .05, .14, .34, -1.92, .62, z); });
    const s = new THREE.Mesh(geoDatar, sorot); s.scale.set(7, 1, 4); s.position.set(5, .1, 0); grp.add(s);
    grp.rotation.y = dz ? -dz * Math.PI / 2 : (dx > 0 ? 0 : Math.PI); grp.position.y = y0; grp.userData = { dx, dz, o, s: -70 + i * 15, v: 7 + (i % 4) * 1.6 }; scene.add(grp); return grp; });

  // ---------- cahaya berpendar (bloom); kalau pustakanya gagal dimuat, gambar biasa
  let komposer = null, bloom = null;
  try { if (THREE.EffectComposer && THREE.UnrealBloomPass) { komposer = new THREE.EffectComposer(renderer); komposer.addPass(new THREE.RenderPass(scene, camera));
      bloom = new THREE.UnrealBloomPass(new THREE.Vector2(lebar, tinggi), hp ? .8 : 1, .5, .72); komposer.addPass(bloom);
      if (THREE.GammaCorrectionShader) komposer.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader)); } } catch { komposer = null; }

  // ---------- waktu: siang lampu padam & bloom tipis, malam lampu & jendela menyala penuh
  function terapkanWaktu() { langit.perbarui(); const m = langit.malam, lampu = .06 + .94 * m;
    faktorJendela = .18 + .82 * m;
    for (const mat of nyala) mat.emissiveIntensity = mat.userData.n * (mat.userData.jenis === 'jendela' ? faktorJendela : lampu);
    for (const sp of pendarList) { sp.material.opacity = m; sp.visible = m > .05; }
    matGenangan.opacity = sorot.opacity = m; lampuTitik.forEach(p => { p.intensity = 1.1 * m; p.visible = m > .05; });
    if (bloom) { bloom.strength = (hp ? .75 : .9) * (.08 + .92 * m); bloom.threshold = .96 - .16 * m; } }
  terapkanWaktu(); setInterval(() => { if (T) terapkanWaktu(); }, 20000);

  // ---------- kamera: geser = putar, roda/cubit = zoom; diam beberapa detik = berputar pelan sendiri
  const kam = { sudut: .42, tinggi: 58, jarak: 96, pusat: new THREE.Vector3(-2, 0, -12) }; let diamSejak = performance.now();
  const aturKamera = () => { camera.position.set(kam.pusat.x + Math.sin(kam.sudut) * kam.jarak, kam.tinggi, kam.pusat.z + Math.cos(kam.sudut) * kam.jarak); camera.lookAt(kam.pusat); };
  let seret = null, cubit = null; const el = renderer.domElement, jari = new Map(); el.style.touchAction = 'none';
  const jarakJari = () => { const [a, b] = [...jari.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('pointerdown', e => { diamSejak = performance.now(); jari.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture(e.pointerId);
    if (jari.size === 2) { seret = null; cubit = { d: jarakJari(), jarak: kam.jarak, tinggi: kam.tinggi }; } else seret = { x: e.clientX, y: e.clientY, sudut: kam.sudut, tinggi: kam.tinggi, gerak: 0 }; });
  el.addEventListener('pointermove', e => { if (jari.has(e.pointerId)) jari.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (cubit && jari.size === 2) { diamSejak = performance.now(); const k = cubit.d / Math.max(20, jarakJari()); kam.jarak = Math.min(200, Math.max(30, cubit.jarak * k)); kam.tinggi = Math.min(150, Math.max(10, cubit.tinggi * k)); aturKamera(); return; }
    if (!seret) return; diamSejak = performance.now(); const dx = e.clientX - seret.x, dy = e.clientY - seret.y; seret.gerak += Math.abs(dx) + Math.abs(dy); kam.sudut = seret.sudut - dx * .005; kam.tinggi = Math.min(150, Math.max(10, seret.tinggi + dy * .1)); aturKamera(); });
  const lepas = e => { jari.delete(e.pointerId); if (jari.size < 2) cubit = null; if (seret && seret.gerak < 6 && e.type === 'pointerup') ketuk(e); seret = null; };
  el.addEventListener('pointerup', lepas); el.addEventListener('pointercancel', lepas);
  el.addEventListener('wheel', e => { diamSejak = performance.now(); const k = 1 + e.deltaY * .001; kam.jarak = Math.min(200, Math.max(30, kam.jarak * k)); kam.tinggi = Math.min(150, Math.max(10, kam.tinggi * k)); aturKamera(); }, { passive: true });
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  function ketuk(e) { const r = el.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, camera);
    const hit = ray.intersectObjects(dapatDiketuk, true)[0]; if (!hit) return; let o = hit.object; while (o && !o.userData.gedung && !o.userData.agen) o = o.parent;
    if (o?.userData.agen) bukaPanel(o.userData.agen); else if (o?.userData.gedung) bukaGedung(o.userData.gedung); }

  // ---------- label gedung dan panel gaya ruang kendali
  wadah.classList.add('kompleks');
  const labels = document.createElement('div'); labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'; wadah.appendChild(labels);
  const dipakai = GEDUNG.filter(g => TATA_KOMPLEKS[g.id] && g.jenis !== 'taman');
  dipakai.forEach(g => { const l = document.createElement('div'); l.className = 'label gedung'; l.onclick = () => bukaGedung(g); labels.appendChild(l); g.label = l; });
  const hud = document.createElement('div'); hud.className = 'hud'; hud.innerHTML = `<div class="hud-atas"><span>HANIF DOSSIER</span><i>//</i><span>INTERNAL</span><i>//</i><b>KOMPLEKS OPERASI</b><span class="hud-live"><em></em>LIVE</span><span class="hud-jam" id="hudJam"></span></div>
    <div class="hud-panel hud-unit"><div class="hud-judul">UNIT KERJA <span id="hudRingkas"></span></div><div id="hudUnit"></div></div>
    <div class="hud-panel hud-log"><div class="hud-judul">LOG KEGIATAN</div><div id="hudLog"></div></div>`;
  wadah.appendChild(hud);
  const ukur = () => { const w = wadah.clientWidth, h = wadah.clientHeight, kecil = w < 600; renderer.setSize(w, h); komposer?.setSize(w, h); camera.aspect = w / h; camera.fov = kecil ? 55 : 40;
    if (!kam.diatur) { if (kecil) kam.pusat.set(-5, 0, -6); kam.jarak = kecil ? 150 : 96; kam.tinggi = kecil ? 112 : 58; kam.sudut = kecil ? .62 : .42; kam.diatur = true; } camera.updateProjectionMatrix(); aturKamera(); };
  addEventListener('resize', ukur); ukur();

  const kd = GEDUNG.find(g => g.jenis === 'kedai'), ark = GEDUNG.find(g => g.jenis === 'arkade'), gal = GEDUNG.find(g => g.jenis === 'galeri');
  const NAMA_ST = { kerja: 'kerja', selesai: 'selesai', gagal: 'perlu dicek', istirahat: 'siaga' };
  function segar() { const KD = Object.fromEntries(AGEN.map(a => [a.kode, keadaan(a)]));
    for (const g of dipakai) { if (g.agen) { g.agen.forEach((k, i) => g.lantai[i] && aturLantai(g.lantai[i], KD[k]?.st || 'istirahat'));
        const hitung = { kerja: 0, selesai: 0, gagal: 0 }; g.agen.forEach(k => { const st = KD[k]?.st; if (hitung[st] !== undefined) hitung[st]++; });
        g.st = hitung.gagal ? 'gagal' : hitung.kerja ? 'kerja' : hitung.selesai ? 'selesai' : 'istirahat';
        const ring = [hitung.kerja && hitung.kerja + ' kerja', hitung.selesai && hitung.selesai + ' selesai', hitung.gagal && hitung.gagal + ' gagal'].filter(Boolean).join(' · ') || 'semua siaga';
        g.label.innerHTML = `<div class="gelembung">${g.agen.map(k => `<span class="titikS ${KD[k]?.st}"></span>${esc(agenKode(k)?.nama || k)}`).join(' ')}<br><small>${ring}</small></div><div class="nama">${esc(g.nama)}</div>`; }
      g.label.className = 'label gedung ' + (g.st || 'istirahat'); }
    // kedai: karyawan yang sedang siaga duduk ngopi
    const nongkrong = AGEN.filter(a => KD[a.kode].st === 'istirahat').slice(0, kd.kursi.length), ada = new Set(nongkrong.map(a => a.kode));
    for (const k in kd.orang) if (!ada.has(k)) { kd.grup.remove(kd.orang[k].g); kd.orang[k].label.remove(); delete kd.orang[k]; }
    nongkrong.forEach((a, i) => { if (kd.orang[a.kode]) return; const o = buatOrang(a, .72), [x, z, hadap] = kd.kursi[i]; o.g.position.set(x, y0 - .2, z); o.kakiK.rotation.x = o.kakiN.rotation.x = 1.5; o.g.rotation.y = hadap * Math.PI / 2 + Math.PI; o.g.userData.agen = a; kd.grup.add(o.g);
      const l = document.createElement('div'); l.className = 'label istirahat kecil'; l.innerHTML = `<div class="nama">${esc(a.nama)}</div>`; l.onclick = () => bukaPanel(a); labels.appendChild(l); o.label = l; o.x = kd.x + x; o.z = kd.z + z; kd.orang[a.kode] = o; });
    kd.label.innerHTML = `<div class="gelembung">${nongkrong.length ? nongkrong.length + ' orang lagi ngopi' : 'sepi, semua lagi kerja'}</div><div class="nama">Kedai Kopi</div>`;
    const rekorFps = +(localStorage.getItem('kantor-fps-rekor') || 0), rekor = +(localStorage.getItem('kantor-rekor') || 0);
    ark.label.innerHTML = `<div class="gelembung">3 game · Operasi Brankas${rekorFps ? ' · rekor ' + rekorFps.toLocaleString('id-ID') : rekor ? ' · rekor ' + rekor : ''}</div><div class="nama">Arkade</div>`;
    gal.label.innerHTML = `<div class="gelembung">${PRODUK.web2.length} produk Web2 · ${PRODUK.web3.length} produk Web3</div><div class="nama">Galeri</div>`;
    // panel unit kerja
    const unit = dipakai.filter(g => g.agen); let aktif = 0;
    $('#hudUnit').innerHTML = unit.map(g => { const s = g.agen.map(k => KD[k]?.st), jalan = s.filter(x => x === 'kerja' || x === 'selesai').length, gagal = s.filter(x => x === 'gagal').length; aktif += jalan;
      return `<div class="hud-baris ${g.st}" data-g="${g.id}"><span class="hud-nm">${esc(g.nama)}</span><span class="hud-bar"><i style="width:${Math.round(jalan / g.agen.length * 100)}%"></i></span><span class="hud-n">${jalan}/${g.agen.length}${gagal ? ` <b>${gagal}!</b>` : ''}</span></div>`; }).join('');
    $('#hudRingkas').textContent = aktif + '/' + AGEN.length + ' AKTIF';
    $$('#hudUnit [data-g]').forEach(b => b.onclick = () => bukaGedung(GEDUNG.find(g => g.id === b.dataset.g)));
    // log kegiatan terbaru dari riwayat semua karyawan
    const log = AGEN.flatMap(a => (DATA?.riwayat?.[a.kode] || []).filter(r => r.status && r.status !== 'istirahat').map(r => ({ a, r }))).sort((x, y) => new Date(y.r.waktu) - new Date(x.r.waktu)).slice(0, hp ? 3 : 7);
    $('#hudLog').innerHTML = log.length ? log.map(({ a, r }) => `<div class="hud-ln ${r.status}"><span>${esc(jam(r.waktu))}</span><b>${esc(a.nama)}</b> ${esc(NAMA_ST[r.status] || r.status)}: ${esc((r.hasil || r.tugas || '').slice(0, 70))}</div>`).join('') : '<div class="hud-ln">Belum ada kegiatan tercatat hari ini.</div>'; }

  const v3 = new THREE.Vector3(); let t0 = performance.now(), detikLalu = -1;
  function tempatkan(l, x, y, z) { v3.set(x, y, z).project(camera); const r = wadah.getBoundingClientRect(); l.style.transform = `translate(${(v3.x + 1) / 2 * r.width}px, ${(1 - v3.y) / 2 * r.height}px) translate(-50%,-100%)`; l.style.opacity = v3.z < 1 ? 1 : 0; }
  function gambar(now) { if (!T) return; const t = now / 1000, dt = Math.min(.05, (now - t0) / 1000); t0 = now;
    if (now - diamSejak > 7000) { kam.sudut += dt * .035; aturKamera(); }
    for (const m of mobil) { const u = m.userData; u.s += u.v * dt; if (u.s > 74) u.s = -74; if (u.dx) m.position.set(u.s * u.dx, y0, u.o); else m.position.set(u.o, y0, u.s * u.dz * .72); }
    if (T_pita) T_pita.offset.x = (T_pita.offset.x + dt * .05) % 1;
    for (const k of kedip) { const on = Math.sin(t * 2.2 + k.fase) > .55; k.m.material.emissiveIntensity = on ? 3.2 : .15; k.s.visible = on; }
    ark.lampuKecil.forEach((b, i) => { b.material.emissiveIntensity = Math.sin(t * 5 + i * .8) > 0 ? 2.4 : .25; });
    gal.pajangan.forEach((p, i) => { p.rotation.y = t * .8 + i; p.position.y = y0 + 1.9 + Math.sin(t * 2 + i) * .1; });
    for (const k in kd.orang) { const o = kd.orang[k]; o.kepala.rotation.y = Math.sin(t * .7 + o.x) * .3; o.lenganN.rotation.x = (t + o.x) % 6 < 1.4 ? 2.45 : .7; tempatkan(o.label, o.x, 2.3, o.z); }
    for (const g of dipakai) tempatkan(g.label, g.x, g.puncak + .6, g.z);
    const dtk = Math.floor(t); if (dtk !== detikLalu) { detikLalu = dtk; const j = $('#hudJam'); if (j) j.textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Pontianak', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB'; }
    if (komposer) komposer.render(); else renderer.render(scene, camera); T.raf = requestAnimationFrame(gambar); }
  T = { renderer, scene, camera, labels, raf: 0, segar }; gambar(performance.now()); }
