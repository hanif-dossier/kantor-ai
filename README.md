# Kantor AI

Papan pantau semua karyawan AI dari HP: siapa yang sedang bekerja, apa yang dikerjakan, hasilnya, dan biaya hari ini,
digambar sebagai kantor 3D (Three.js). Alamat: https://kantor.markasku.my.id

Halaman ini hanya kode tampilan. Semua status tersimpan di database dan hanya bisa dibaca setelah masuk dengan sandi
pemilik. Tidak ada angka usaha, nama orang, atau kunci apa pun di repo ini.

## Cara kerja

1. Tiap karyawan AI (workflow GitHub Actions, skrip n8n di laptop, routine Claude) memanggil `alat/lapor.mjs`
   saat mulai (`kerja`), selesai (`selesai`), atau gagal (`gagal`). Kuncinya dari env `KANTOR_KUNCI`.
2. Halaman membaca `kantor_data` dengan token sesi (30 hari) dan menggambar meja per karyawan: gelembung tugas,
   warna status, angka di atas (aktif, selesai, biaya, token).
3. Ketuk karyawan untuk riwayat dan tombol "Suruh kerja sekarang". Perintah masuk antrean dan diambil karyawan itu
   saat ia jalan berikutnya (yang di laptop membacanya tiap 10 menit saat laptop menyala).
4. Dua tampilan, tombol "Lihat kota / Lihat kantor". Kota: satu gedung per kelompok karyawan, satu lantai per
   karyawan, jendela menyala sesuai status (hijau kerja, kuning selesai, merah gagal). Yang istirahat nongkrong di
   Kedai Kopi. Arkade berisi permainan tangkap koin. Galeri memajang produk Web2 dan Web3. Taman = lahan gedung
   berikutnya. Menambah lantai: naikkan `lantaiTambahan` di daftar `GEDUNG`, atau tambah karyawan ke `AGEN` dan
   masukkan kodenya ke gedungnya. Malam hari (18.00 sampai 05.00) langit gelap dan lampu jalan menyala.

## Berkas

- `index.html`, `sw.js`, `manifest.json`, ikon: aplikasi web (bisa dipasang di HP).
- `supabase/skema.sql`: tabel `kantor_*` dan fungsi `kantor_masuk / kantor_lapor / kantor_data / kantor_perintah`.
- `alat/pasang-db.mjs`: memasang skema dan membuat sandi (sekali). `alat/lapor.mjs`: pelapor untuk skrip Node.
