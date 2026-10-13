/* =====================================================================================================
   Langit Kompleks Hanif (13 Okt 2026). Pemilik: "sesuaikan dengan waktu jangan malam terus". Matahari dihitung dari jam
   WIB yang sebenarnya (posisi matahari di Indonesia, lintang -2, bujur 110), langit fisik Preetham (THREE.Sky) untuk siang,
   senja, dan fajar, kubah malam dengan bintang dan bulan, cahaya matahari dengan bayangan, kabut yang warnanya mengikuti
   cakrawala, dan peta pantulan (environment map) dari langit itu sendiri supaya kaca gedung memantulkan langit.
   buatLangit(scene, renderer) -> { perbarui(), malam (0 siang .. 1 malam), matahari (DirectionalLight), info }.
   Untuk melihat jam tertentu: ?jam=17.5 di alamat halaman.
   ===================================================================================================== */
function buatLangit(scene, renderer, opsi = {}) {
  const hp = !!opsi.hp, LINTANG = -2 * Math.PI / 180, BUJUR = 110, rad = Math.PI / 180;
  const jamPaksa = (() => { const j = new URLSearchParams(location.search).get('jam'); return j == null ? null : +j; })();
  scene.background = null;

  // ---------- langit siang (Preetham) dan kubah malam
  const sky = new THREE.Sky(); sky.scale.setScalar(1800); scene.add(sky);
  const U = sky.material.uniforms; U.turbidity.value = 7; U.rayleigh.value = 1.6; U.mieCoefficient.value = .0045; U.mieDirectionalG.value = .82;
  const kubahGeo = new THREE.SphereGeometry(1700, 32, 16), kp = kubahGeo.attributes.position, kw = [];
  const kA = new THREE.Color('#050913').convertSRGBToLinear(), kT = new THREE.Color('#111b33').convertSRGBToLinear(), kB = new THREE.Color('#2a2742').convertSRGBToLinear();
  for (let i = 0; i < kp.count; i++) { const k = kp.getY(i) / 1700, c = k > 0 ? kT.clone().lerp(kA, Math.min(1, k * 1.6)) : kB.clone(); if (k > 0 && k < .12) c.copy(kB).lerp(kT, k / .12); kw.push(c.r, c.g, c.b); }
  kubahGeo.setAttribute('color', new THREE.Float32BufferAttribute(kw, 3));
  const kubah = new THREE.Mesh(kubahGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  kubah.renderOrder = -1; scene.add(kubah);
  // bintang
  const nB = hp ? 900 : 1800, pb = new Float32Array(nB * 3); let benih = 11; const rnd = () => (benih = (benih * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < nB; i++) { const a = rnd() * Math.PI * 2, y = .08 + rnd() * .92, r = Math.sqrt(1 - y * y); pb.set([Math.cos(a) * r * 1600, y * 1600, Math.sin(a) * r * 1600], i * 3); }
  const gb = new THREE.BufferGeometry(); gb.setAttribute('position', new THREE.BufferAttribute(pb, 3));
  const bintang = new THREE.Points(gb, new THREE.PointsMaterial({ color: 0xdfe8ff, size: hp ? 1.6 : 1.8, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  scene.add(bintang);
  // bulan
  const cb = document.createElement('canvas'); cb.width = cb.height = 128; const xb = cb.getContext('2d'), gr = xb.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,252,240,1)'); gr.addColorStop(.22, 'rgba(250,246,230,1)'); gr.addColorStop(.26, 'rgba(200,215,255,.35)'); gr.addColorStop(1, 'rgba(160,180,255,0)'); xb.fillStyle = gr; xb.fillRect(0, 0, 128, 128);
  const bulan = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cb), transparent: true, depthWrite: false, fog: false, toneMapped: false })); bulan.scale.setScalar(150); scene.add(bulan);

  // ---------- cahaya: matahari (atau bulan saat malam) dengan bayangan, langit-tanah
  const matahari = new THREE.DirectionalLight(0xffffff, 2); matahari.castShadow = true;
  const S = matahari.shadow; S.mapSize.set(hp ? 1024 : 4096, hp ? 1024 : 4096); S.camera.left = S.camera.bottom = -100; S.camera.right = S.camera.top = 100; S.camera.near = 10; S.camera.far = 420; S.bias = -.0004; S.normalBias = .04;
  scene.add(matahari, matahari.target);
  const langitTanah = new THREE.HemisphereLight(0xbcd6ff, 0x5b5346, .6); scene.add(langitTanah);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---------- peta pantulan dari langit (dibuat ulang saat langit berubah cukup jauh)
  // Langit fisik terlalu terang untuk dipantulkan (cakram matahari memutihkan semua permukaan), jadi pantulan memakai kubah
  // warna: puncak, cakrawala, tanah, dan pendar matahari yang lembut, warnanya mengikuti waktu.
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envGeo = new THREE.SphereGeometry(500, 32, 16), envWarna = new Float32Array(envGeo.attributes.position.count * 3);
  envGeo.setAttribute('color', new THREE.BufferAttribute(envWarna, 3)); envScene.add(new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pendarEnv = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); envScene.add(pendarEnv);
  const warnaiEnv = (puncak, cakrawala, tanah) => { const p = envGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = p.getY(i) / 500;
      const c = k >= 0 ? cakrawala.clone().lerp(puncak, Math.pow(k, .6)) : cakrawala.clone().lerp(tanah, Math.min(1, -k * 6)); envWarna.set([c.r, c.g, c.b], i * 3); } envGeo.attributes.color.needsUpdate = true; };
  let envRT = null, envKunci = '';

  // ---------- posisi matahari dari jam WIB
  function posisiMatahari(d) {
    const awal = Date.UTC(d.getUTCFullYear(), 0, 0), hari = (d.getTime() - awal) / 864e5;
    const g = 2 * Math.PI / 365 * (hari - 1), decl = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g);
    const eot = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));   // menit
    let utcJam = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    if (jamPaksa != null) utcJam = jamPaksa - 7;
    const surya = utcJam * 60 + eot + 4 * BUJUR, H = (surya / 4 - 180) * rad;
    const tinggi = Math.asin(Math.sin(LINTANG) * Math.sin(decl) + Math.cos(LINTANG) * Math.cos(decl) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LINTANG) - Math.tan(decl) * Math.cos(LINTANG));   // dari selatan, positif ke barat
    // arah ke matahari di dunia: selatan = +z, barat = -x (utara kompleks = -z)
    return { tinggi, arah: new THREE.Vector3(-Math.sin(az) * Math.cos(tinggi), Math.sin(tinggi), Math.cos(az) * Math.cos(tinggi)).normalize() };
  }
  const halus = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const C = (h) => new THREE.Color(h);
  const out = { matahari, langitTanah, malam: 0, info: '' };
  out.perbarui = function () {
    const { tinggi, arah } = posisiMatahari(new Date()), deg = tinggi / rad;
    const malam = 1 - halus(-9, 2, deg), senja = halus(-6, 3, deg) * (1 - halus(8, 22, deg));   // 1 saat matahari rendah
    out.malam = malam; out.senja = senja; out.tinggi = deg;
    U.sunPosition.value.copy(arah).multiplyScalar(1000);
    kubah.material.opacity = Math.min(1, malam * 1.15); sky.visible = malam < .995;
    bintang.material.opacity = halus(.55, 1, malam) * .95; bintang.visible = malam > .5;
    // bulan di sisi berlawanan matahari, agak miring
    const ab = arah.clone().negate(); ab.y = Math.max(.35, Math.abs(ab.y)); ab.normalize(); bulan.position.copy(ab).multiplyScalar(1500); bulan.material.opacity = halus(.4, 1, malam); bulan.visible = malam > .4;
    // cahaya utama: matahari saat siang, bulan saat malam
    const sumber = malam < .6 ? arah : ab, tinggiS = Math.max(.12, sumber.y);
    matahari.position.copy(sumber).multiplyScalar(220); matahari.target.position.set(0, 0, -10);
    const warnaSiang = C(0xfff3e2).lerp(C(0xffa25a), senja), warnaMalam = C(0x9fb3e6);
    matahari.color.copy(warnaSiang).lerp(warnaMalam, malam);
    matahari.intensity = (1 - malam) * (.35 + 1.05 * Math.sqrt(Math.max(0, Math.sin(tinggi)))) * (1 - senja * .3) + malam * .16;
    void tinggiS;
    langitTanah.color.copy(C(0xbcd6ff).lerp(C(0xffc7a0), senja * .6)).lerp(C(0x51669a), malam);
    langitTanah.groundColor.copy(C(0x6b5f4c)).lerp(C(0x07080b), malam);
    langitTanah.intensity = .42 * (1 - malam) + .13 * malam;
    // kabut menyatu dengan cakrawala
    if (scene.fog) { const kabutSiang = C('#c7d6e6').lerp(C('#e8b48f'), senja * .8); scene.fog.color.copy(kabutSiang.lerp(C('#070b14'), malam)).convertSRGBToLinear(); scene.fog.density = (hp ? .0026 : .0028) * (1 - malam) + (hp ? .0055 : .006) * malam; }
    renderer.toneMappingExposure = .62 * (1 - malam) + .95 * malam;
    const lin = h => new THREE.Color(h).convertSRGBToLinear();
    const puncak = lin('#3f74b8').lerp(lin('#4a5a8a'), senja * .5).lerp(lin('#060a14'), malam), cakrawala = lin('#bcd3e8').lerp(lin('#f0b78a'), senja).lerp(lin('#1a2238'), malam), tanah = lin('#5e584c').lerp(lin('#07080a'), malam);
    warnaiEnv(puncak, cakrawala, tanah); pendarEnv.position.copy(arah).multiplyScalar(420); pendarEnv.material.color.copy(lin('#fff1d8').lerp(lin('#ff9a50'), senja)).multiplyScalar(2.5 * (1 - malam)); pendarEnv.visible = malam < .9;
    // pantulan: buat ulang kalau matahari bergeser > 1,5 derajat atau malam berubah
    const kunci = Math.round(deg / 1.5) + '|' + Math.round(malam * 10);
    if (kunci !== envKunci) { envKunci = kunci; const lama = envRT; envRT = pm.fromScene(envScene, 0, 1, 2000); scene.environment = envRT.texture; if (lama) lama.dispose(); }
    const j = jamPaksa != null ? jamPaksa : null;
    out.info = (j != null ? `jam ${j}` : '') + ` matahari ${deg.toFixed(1)}°`;
    return out; };
  out.perbarui();
  return out; }
