/* =====================================================================================================
   Arsitektur kota nyata (16 Okt 2026). Pemilik: "design dan architecture nya saya tidak suka", lalu "coba ubah design
   untuk kota nya dulu". Model kartun Kenney (gedung warna-warni, pohon kerucut, kincir mainan) diganti bangunan yang
   digambar sendiri:
   - bahanFasad(): kulit gedung dari shader, tanpa tekstur gambar. Koordinat diambil dari posisi dunia, jadi satu bahan
     bisa dipakai kotak berukuran apa pun (juga InstancedMesh): kaca dengan rangka (mullion), pita lantai (spandrel),
     ruangan di balik kaca yang menyala acak pada malam hari (lampu plafon, tirai, ruang kosong), atau dinding beton
     berlubang jendela untuk apartemen. Sisi atas kotak otomatis jadi atap beton.
   - geoPohon(): pohon peneduh (trembesi/ketapang) dari gumpalan daun yang permukaannya diacak, batang bercabang.
   - Dipakai kompleks.js lewat buatArsitektur(y0).
   ===================================================================================================== */
function buatArsitektur(y0) {
  // nilai malam bersama semua fasad (0 siang .. 1 malam), diisi kompleks.js tiap waktu berganti
  const SERAGAM = { uMalam: { value: 0 } };
  let jenisKe = 0;
  // o: lantai (tinggi per lantai), jendela (lebar modul), rangka (tebal mullion), spandrel (bagian bawah lantai yang
  // tertutup), kaca/bingkai/dinding (warna sRGB), lubang (0 = dinding kaca penuh, >0 = dinding beton dengan jendela),
  // lubang >= .5 = dinding panel tanpa jendela (gudang, pabrik);
  // nyala (bagian ruangan yang terisi orang), siang (cahaya ruang dalam saat siang), tabung (pusat [x,z] untuk silinder),
  // alas (tinggi dasar hitungan lantai; gedung karyawan memakai dasar tiap lantainya sendiri)
  function bahanFasad(o = {}) {
    const P = { lantai: 3.4, jendela: 1.5, rangka: .07, spandrel: .26, kaca: 0x34495a, bingkai: 0x2a2f35, dinding: 0xd9d4ca, atap: 0x8d8c88, lubang: 0, nyala: .55, siang: .05, tabung: null, alas: y0, ...o };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .1, metalness: .8, emissive: new THREE.Color(1, .86, .66), emissiveIntensity: 1, envMapIntensity: P.lubang > 0 ? .4 : .8 });
    const kunci = 'fasad' + (P.tabung ? 't' : 'k') + (P.lubang > 0 ? 'l' : 'g');
    m.userData.fasad = P;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, SERAGAM, { uLantai: { value: P.lantai }, uJendela: { value: P.jendela }, uRangka: { value: P.rangka }, uSpandrel: { value: P.spandrel },
        uKaca: { value: warnaL(P.kaca) }, uBingkai: { value: warnaL(P.bingkai) }, uDinding: { value: warnaL(P.dinding) }, uAtap: { value: warnaL(P.atap) },
        uLubang: { value: P.lubang }, uNyala: { value: P.nyala }, uSiang: { value: P.siang }, uY0: { value: P.alas }, uPusat: { value: new THREE.Vector2(...(P.tabung || [0, 0])) } });
      sh.vertexShader = 'varying vec3 vPosF; varying vec3 vNorF;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 pfN = vec4(transformed, 1.0); vec3 nfN = objectNormal;
        #ifdef USE_INSTANCING
          pfN = instanceMatrix * pfN; nfN = mat3(instanceMatrix) * nfN;
        #endif
        vPosF = (modelMatrix * pfN).xyz; vNorF = normalize(mat3(modelMatrix) * nfN);`);
      sh.fragmentShader = `varying vec3 vPosF; varying vec3 vNorF;
        uniform float uMalam, uLantai, uJendela, uRangka, uSpandrel, uLubang, uNyala, uSiang, uY0; uniform vec3 uKaca, uBingkai, uDinding, uAtap; uniform vec2 uPusat;
        float hashF(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fAtap, fKaca, fNyalaF, fH1, fH2; vec3 fWarna, fRona; float fKasar, fLogam;
        ` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 n = normalize(vNorF); fAtap = step(.7, abs(n.y));
            ${P.tabung ? 'vec2 dr = vPosF.xz - uPusat; float u = atan(dr.y, dr.x) * length(dr);' : 'vec2 t = normalize(vec2(-n.z, n.x) + 1e-5); float u = dot(vPosF.xz, t);'}
            float v = (vPosF.y - uY0) / uLantai; vec2 sel = vec2(u / uJendela, v), id = floor(sel), f = fract(sel);
            float sisi = floor(n.x * 3.0 + n.z * 7.0 + 20.0);
            float h1 = hashF(id + sisi * 13.1), h2 = hashF(id.yx * 1.7 + sisi), hLt = hashF(vec2(id.y, sisi * 3.3));
            fH1 = h1; fH2 = h2; float rw = uRangka / uJendela;
            float mullion = 1.0 - step(rw, f.x) * step(f.x, 1.0 - rw);
            float pita = step(f.y, uSpandrel);
            fKaca = (1.0 - max(mullion, pita));
            if (uLubang > 0.0) fKaca = step(uLubang, f.x) * step(f.x, 1.0 - uLubang) * step(uSpandrel + .12, f.y) * step(f.y, .9);
            float sambung = 0.0; if (uLubang >= .5) { fKaca = 0.0; sambung = max(step(f.x, .012), step(f.y, .01)); }   // dinding panel pracetak tanpa jendela
            // ruang di balik kaca: lampu plafon lebih terang di atas, tirai sebagian, sebagian ruang kosong/gelap
            float isi = step(1.0 - uNyala, h1 * .65 + hLt * .35);
            float tirai = step(.66, h2) * step(1.0 - (.25 + .6 * h1), f.y) * fKaca;
            float plafon = .45 + .55 * smoothstep(.25, .95, f.y);
            fNyalaF = fKaca * isi * plafon * (1.0 - tirai * .7) * mix(uSiang, 1.0, uMalam) * (.3 + .9 * h2 * h2) * .55;
            // kaca bawah memantulkan tanah & gedung lain (lebih gelap), kaca atas memantulkan langit
            float tinggiK = clamp((vPosF.y - uY0) / 60.0, 0.0, 1.0);
            fRona = h2 > .62 ? vec3(.78, .9, 1.15) : vec3(1.0);   // sebagian ruang berlampu putih dingin
            vec3 kaca = mix(uKaca * (.8 + .4 * h1) * (.75 + .35 * tinggiK), vec3(.42, .39, .34), tirai * .8);
            vec3 dinding = uLubang > 0.0 ? uDinding * (.93 + .1 * hLt) * (1.0 - sambung * .45) : uBingkai;
            fWarna = fAtap > .5 ? uAtap : mix(dinding, kaca, fKaca);
            fKasar = fAtap > .5 ? .92 : mix(uLubang > 0.0 ? .82 : .38, mix(.06 + .06 * h2, .3, tirai), fKaca);
            fLogam = fAtap > .5 ? 0.0 : mix(uLubang > 0.0 ? 0.0 : .55, mix(.88, .45, tirai), fKaca);
            if (fAtap > .5) fNyalaF = 0.0;
            diffuseColor.rgb *= fWarna * (1.0 - .6 * uMalam * (1.0 - fKaca));
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = fKasar;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = fLogam;')
        // tiap panel kaca sedikit miring (seperti kaca gedung sungguhan), jadi pantulan langit pecah per panel
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize(normal + (vec3(fH1, fH2, fract(fH1 * 7.13)) - .5) * .09 * fKaca);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= fNyalaF * fRona;'); };
    m.customProgramCacheKey = () => kunci;
    return m; }

  // ---------- pohon peneduh: batang + cabang + 6 gumpalan daun berpermukaan acak, warna per titik (bawah tajuk lebih gelap)
  function geoPohon(benih = 3, ramping = false, halus = 2) {   // halus 1 untuk HP (segitiga 4x lebih sedikit)
    let b = benih; const r = () => (b = (b * 16807) % 2147483647) / 2147483647;
    const bagian = [], tambah = (g, warna, gelap = 0) => { g = g.toNonIndexed(); g.computeVertexNormals(); const p = g.attributes.position, w = [];
      for (let i = 0; i < p.count; i++) { const k = gelap ? .62 + .38 * Math.min(1, Math.max(0, (p.getY(i) - .42) / .5)) : 1; w.push(warna.r * k, warna.g * k, warna.b * k); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(w, 3)); bagian.push(g); };
    const batang = new THREE.CylinderGeometry(.022, .04, .48, 7).translate(0, .24, 0); tambah(batang, warnaL(0x5b4a3a));
    for (let i = 0; i < 3; i++) { const c = new THREE.CylinderGeometry(.008, .016, .26, 5); c.translate(0, .13, 0); c.rotateZ(.7 * (r() > .5 ? 1 : -1)); c.rotateY(i * 2.1); c.translate(0, .36, 0); tambah(c, warnaL(0x5b4a3a)); }
    const daun = [0x4f7a34, 0x5c8a3a, 0x416d2e, 0x6a9442], n = ramping ? 4 : 5;
    for (let i = 0; i < n; i++) { const g = new THREE.IcosahedronGeometry(1, halus), p = g.attributes.position, s = ramping ? .17 : .2 + r() * .08;
      for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), d = 1 + (Math.sin(x * 5.1 + benih) * Math.cos(z * 4.3 + y * 3.7) * .14) + (r() - .5) * .06; p.setXYZ(k, x * d, y * d * .78, z * d); }
      const a = i / n * Math.PI * 2 + r(), jr = i === 0 ? 0 : (ramping ? .1 : .19) + r() * .06;
      g.scale(s, s, s); g.translate(Math.cos(a) * jr, (ramping ? .62 : .6) + (i === 0 ? .14 : r() * .12) + (ramping ? i * .06 : 0), Math.sin(a) * jr); tambah(g, warnaL(daun[(r() * 4) | 0]), 1); }
    // gabung jadi satu geometri (tanpa BufferGeometryUtils)
    const total = bagian.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3); let o = 0;
    for (const g of bagian) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const hasil = new THREE.BufferGeometry(); hasil.setAttribute('position', new THREE.BufferAttribute(pos, 3)); hasil.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); hasil.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return hasil; }
  const bahanPohon = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0, envMapIntensity: .35 });

  return { SERAGAM, bahanFasad, geoPohon, bahanPohon }; }
