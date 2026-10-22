# Checklist Uji Penerimaan Pengguna (UAT) — Antarmuka Aplikasi

Uji ini dilakukan **manual lewat aplikasi** (login sungguhan ke Supabase), untuk melengkapi
uji otomatis database di `tests/uji-database.html`.

**Sebelum mulai**
- Pastikan project Supabase tidak *paused* dan data demo segar (jalankan ulang 4 file SQL).
- Uji ini **mengubah data live**. Setelah selesai, jalankan ulang 4 file SQL agar data demo kembali bersih.
- Isi kolom **Hasil** dengan ✅ (sesuai harapan) atau ❌ + catatan singkat.

Penguji: ____________________ Tanggal: ____________ Browser/perangkat: ____________________

---

## A. Login & peran

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| A1 | Buka aplikasi tanpa login | Hanya layar login yang tampil, tidak ada data | |
| A2 | Login dengan password salah | Pesan gagal login, tetap di layar login | |
| A3 | Login sebagai **admin** | Dashboard tampil; kartu pengguna menunjukkan peran admin | |
| A4 | (admin) Buka menu Peralatan & Member | Form tambah/edit peralatan dan tombol "Paket baru"/aktif-nonaktif paket **tidak tampil** | |
| A5 | Logout, login sebagai **owner** | Semua menu & tombol khusus owner tampil | |

## B. Siklus booking (login sebagai admin)

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| B1 | Booking baru: hari kerja 16:00–18:00, Court A | Pratinjau tarif **Rp 500.000 (campuran)** | |
| B2 | Simpan booking B1 | Booking tampil berstatus "menunggu"; slot di grid jadwal terisi | |
| B3 | Buat booking lain yang bentrok dengan B1 (17:00–19:00, Court A, tanggal sama) | Ditolak: "Jadwal bentrok dengan booking …" | |
| B4 | Pembayaran DP Rp 100.000 (tunai) untuk B1 | Status booking menjadi "dp"; sisa tagihan Rp 400.000 | |
| B5 | Pembayaran Rp 500.000 untuk B1 | Ditolak: melebihi sisa tagihan | |
| B6 | Pelunasan Rp 400.000 via QRIS | Status "lunas"; sisa Rp 0 | |
| B7 | Menu Jurnal Umum | Ada jurnal Kas/PDDM Rp 100.000 dan **Saldo QRIS**/PDDM Rp 400.000; total debit = kredit | |
| B8 | Cetak kwitansi pelunasan B6 | Kwitansi berisi nomor KW-, terbilang "empat ratus ribu rupiah", metode QRIS | |
| B9 | Cetak konfirmasi booking B1 | Berisi jadwal, rincian pembayaran, **ketentuan pembatalan**, dan **pernyataan privasi data** | |
| B10 | Coba tandai B1 "selesai" (jadwal belum dimulai) | Ditolak: booking belum dimainkan | |

## C. Pembatalan

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| C1 | (admin) Buat booking ≥ 2 hari lagi, bayar DP, lalu klik Batal | Dialog menampilkan pratinjau **refund**; simpan ditolak karena refund hanya owner | |
| C2 | (owner) Batalkan booking C1, refund via transfer | Status "batal (refund)"; jurnal PDDM / **Bank** sebesar DP | |
| C3 | (admin) Batalkan booking hari ini yang sudah DP (< 24 jam) | Pratinjau **hangus**; jurnal PDDM / Pendapatan Lain-lain | |

## D. Dashboard & pengakuan pendapatan

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| D1 | Buka Dashboard | Banner "perlu tindakan" muncul bila ada booking lunas yang sudah lewat jam main | |
| D2 | Klik tombol selesaikan massal | Banner hilang/berkurang; pendapatan bulan ini bertambah | |
| D3 | Periksa kartu kas + bank + QRIS dan PDDM | Angka berubah sesuai transaksi di bagian B dan C | |

## E. Peralatan & paket member

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| E1 | Sewa 2 Raket Padel Pro pada sebuah booking | Stok berkurang 2; jurnal Pendapatan Sewa Peralatan | |
| E2 | Kembalikan dengan status rusak 1 unit | Denda **Rp 750.000** dihitung otomatis; stok bertambah 1 | |
| E3 | Jual Paket Silver ke pelanggan, lalu buat booking memakai paket | Booking langsung "lunas"; sisa jam paket berkurang | |
| E4 | (admin) Coba ubah tarif lapangan / stok peralatan | Tidak bisa (form tidak tampil; bila dipaksa, database menolak) | |

## F. Laporan

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| F1 | Buku Besar akun 1-103 Saldo QRIS | Saldo berjalan memuat transaksi QRIS dari B6 | |
| F2 | Laporan periode bulan ini | Pendapatan per akun + penerimaan per metode (Kas/Bank/QRIS) tampil | |
| F3 | Cetak laporan | Tampilan cetak rapi, tanpa sidebar | |

## G. Tutup buku (menu Laporan)

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| G1 | (admin) Buka menu Laporan | Panel Tutup Buku tampil tanpa tombol tutup / buka kembali | |
| G2 | (owner) Tutup buku bulan lalu | Bulan lalu tampil di "Periode ditutup" dan di Riwayat | |
| G3 | (owner) Catat pembayaran bertanggal bulan yang ditutup | Ditolak: periode sudah ditutup | |

> Setelah G2, buka kembali bulan tersebut (isi alasan) atau jalankan ulang 4 file SQL agar data demo kembali normal.

## H. Settlement QRIS (menu Pembayaran)

| No | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| H1 | (admin) Buka menu Pembayaran | Ringkasan "Saldo QRIS belum cair" & riwayat settlement tampil; form Catat Settlement **tidak tampil** | |
| H2 | (owner) Catat settlement: kotor Rp 100.000, masuk Bank Rp 99.700, no. referensi baru | Pratinjau MDR Rp 300 (0,3%); tersimpan; jurnal Bank Rp 99.700 & Beban MDR Rp 300 / Saldo QRIS; saldo belum cair turun Rp 100.000 | |

---

**Ringkasan:** ____ dari 33 langkah sesuai harapan.
Catatan / temuan: ____________________________________________________________
