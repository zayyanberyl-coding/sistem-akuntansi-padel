/* ==================================================================
   APP.JS
   Bagian 1: fungsi bantu yang dipakai semua halaman
   Bagian 2: pengatur pindah menu (single-page app)
   ================================================================== */


/* ------------------------------------------------------------------
   BAGIAN 1: FUNGSI BANTU
   ------------------------------------------------------------------ */

// Ambil elemen berdasarkan id. Contoh: $('bk-tanggal')
function $(id) {
  return document.getElementById(id);
}

// Format angka jadi rupiah. Contoh: 150000 -> "Rp 150.000"
function rupiah(angka) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(angka) || 0);
}

// Tanggal hari ini dalam format YYYY-MM-DD (waktu lokal, bukan UTC)
function hariIni() {
  return formatISO(new Date());
}

function formatISO(d) {
  const bulan = String(d.getMonth() + 1).padStart(2, '0');
  const hari = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${bulan}-${hari}`;
}

// Ubah teks "YYYY-MM-DD" jadi objek Date lokal
function keDate(teks) {
  const [t, b, h] = teks.split('-').map(Number);
  return new Date(t, b - 1, h);
}

// Tambah / kurangi hari. Contoh: tambahHari('2026-09-26', -30)
function tambahHari(teks, jumlah) {
  const d = keDate(teks);
  d.setDate(d.getDate() + jumlah);
  return formatISO(d);
}

// Tanggal 1 bulan ini
function awalBulan() {
  return hariIni().slice(0, 8) + '01';
}

// "2026-09-26" -> "26 Sep 2026"
function tanggalIndo(teks) {
  if (!teks) return '-';
  return keDate(teks).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "2026-09-26" -> "Sabtu, 26 September 2026"
function tanggalPanjang(teks) {
  return keDate(teks).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// "08:00:00" -> "08:00"
function jam(teks) {
  return teks ? teks.slice(0, 5) : '';
}

// Angka jam -> teks "HH:00". Contoh: 7 -> "07:00"
function jamKeTeks(angka) {
  return String(angka).padStart(2, '0') + ':00';
}

// Mencegah teks dari database dianggap sebagai HTML (keamanan XSS)
function esc(teks) {
  return String(teks ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Label status berwarna
function badge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(status)}</span>`;
}

// Baris "tidak ada data" untuk tabel
function barisKosong(jumlahKolom, teks = 'Belum ada data') {
  return `<tr><td colspan="${jumlahKolom}" class="kosong">${teks}</td></tr>`;
}

// Notifikasi kecil di pojok kanan bawah
let timerToast;
function tampilkanPesan(pesan, jenis = 'sukses') {
  const el = $('toast');
  el.textContent = pesan;
  el.className = 'toast tampil' + (jenis === 'error' ? ' error' : '');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('tampil'), 4000);
}

// Cek error dari Supabase. Mengembalikan true jika ada error.
// Pesan dari "raise exception" di trigger akan tampil di sini.
function adaError(error) {
  if (!error) return false;
  console.error(error);
  tampilkanPesan(error.message || 'Terjadi kesalahan', 'error');
  return true;
}

// Supabase hanya mengembalikan maksimal 1.000 baris per query.
// Fungsi ini mengambil data per "halaman" 1.000 baris sampai habis.
//   buatQuery : fungsi yang MEMBUAT query baru setiap dipanggil, contoh:
//               ambilSemua(() => db.from('v_jurnal_lengkap').select('*').order('id'))
//   Query sebaiknya punya .order(...) supaya urutan antarhalaman konsisten.
// Hasilnya sama seperti query biasa: { data, error }
async function ambilSemua(buatQuery) {
  const PER_HALAMAN = 1000;
  let semua = [];
  for (let dari = 0; ; dari += PER_HALAMAN) {
    const { data, error } = await buatQuery().range(dari, dari + PER_HALAMAN - 1);
    if (error) return { data: null, error };
    semua = semua.concat(data);
    if (data.length < PER_HALAMAN) return { data: semua, error: null };
  }
}

// Mengisi <select> dengan daftar pilihan
//   daftar     : array data
//   ambilNilai : fungsi -> value option
//   ambilLabel : fungsi -> teks option
//   kosong     : teks pilihan pertama (opsional)
function isiSelect(el, daftar, ambilNilai, ambilLabel, kosong) {
  const nilaiLama = el.value;
  let html = kosong ? `<option value="">${esc(kosong)}</option>` : '';
  for (const item of daftar) {
    html += `<option value="${esc(ambilNilai(item))}">${esc(ambilLabel(item))}</option>`;
  }
  el.innerHTML = html;
  // pertahankan pilihan sebelumnya jika masih ada
  if ([...el.options].some(o => o.value === nilaiLama)) el.value = nilaiLama;
}

// Jumlahkan saldo akun dari baris jurnal sesuai saldo normalnya
//   saldo normal D (Aset)              : debit - kredit
//   saldo normal K (Kewajiban/Pendapatan): kredit - debit
function hitungSaldo(baris, saldoNormal) {
  return baris.reduce((total, b) => {
    const selisih = Number(b.debit) - Number(b.kredit);
    return total + (saldoNormal === 'D' ? selisih : -selisih);
  }, 0);
}


/* ------------------------------------------------------------------
   BAGIAN 2: PINDAH MENU
   Semua halaman sudah ada di index.html sebagai <section class="page">.
   Saat menu diklik, hash di URL berubah (#booking), lalu kita:
     1. sembunyikan semua section,
     2. tampilkan section yang dipilih,
     3. panggil fungsi "siapkan" (sekali saja) dan "muat" (setiap dibuka).
   ------------------------------------------------------------------ */

// Fungsi ditulis sebagai "() => namaFungsi()" karena fungsinya berada di
// file JS lain yang dimuat SETELAH app.js.
const HALAMAN = {
  dashboard:  { judul: 'Dashboard',          siapkan: null,                    muat: () => muatDashboard() },
  booking:    { judul: 'Booking Lapangan',   siapkan: () => siapkanBooking(),    muat: () => muatBooking() },
  pembayaran: { judul: 'Pembayaran',         siapkan: () => siapkanPembayaran(), muat: () => muatPembayaran() },
  peralatan:  { judul: 'Peralatan',          siapkan: () => siapkanPeralatan(),  muat: () => muatPeralatan() },
  member:     { judul: 'Member & Pelanggan', siapkan: () => siapkanMember(),     muat: () => muatMember() },
  jurnal:     { judul: 'Jurnal Umum',        siapkan: () => siapkanJurnal(),     muat: () => muatJurnal() },
  bukubesar:  { judul: 'Buku Besar',         siapkan: () => siapkanBukuBesar(),  muat: () => muatBukuBesar() },
  laporan:    { judul: 'Laporan Pendapatan', siapkan: () => siapkanLaporan(),    muat: () => muatLaporan() }
};

const halamanSudahDisiapkan = new Set();

function bukaHalaman(nama) {
  if (!HALAMAN[nama]) nama = 'dashboard';
  const halaman = HALAMAN[nama];

  // 1 & 2: sembunyikan semua, tampilkan yang dipilih
  document.querySelectorAll('.page').forEach(sec => { sec.hidden = sec.id !== 'page-' + nama; });

  // tandai menu yang aktif
  document.querySelectorAll('.menu a').forEach(a => {
    a.classList.toggle('aktif', a.dataset.page === nama);
  });

  // Animasi (lihat animasi.js): pil menu meluncur & kartu muncul berurutan
  geserIndikatorMenu();
  animasiMasukHalaman($('page-' + nama));

  $('judul-halaman').textContent = halaman.judul;
  $('breadcrumb-halaman').textContent = halaman.judul;
  document.title = halaman.judul + ' - Smash Padel Club';
  $('sidebar').classList.remove('buka');   // tutup sidebar di HP

  // Batal daftar member dari Booking jika pindah ke menu lain (lihat member.js)
  if (nama !== 'member' && nama !== 'booking') daftarDariBooking = false;

  if (!supabaseSudahDiatur) return;        // belum ada koneksi, jangan query

  // 3: siapkan (pasang event listener) cukup sekali
  if (halaman.siapkan && !halamanSudahDisiapkan.has(nama)) {
    halaman.siapkan();
    halamanSudahDisiapkan.add(nama);
  }
  halaman.muat();
}

// Dijalankan setelah seluruh HTML selesai dimuat
document.addEventListener('DOMContentLoaded', () => {
  $('tanggal-hari-ini').textContent = tanggalPanjang(hariIni());
  $('alert-konfigurasi').hidden = supabaseSudahDiatur;

  // Tombol ☰ untuk membuka sidebar di layar kecil
  $('tombol-menu').addEventListener('click', () => $('sidebar').classList.toggle('buka'));

  // Saat hash URL berubah (menu diklik / tombol back browser)
  window.addEventListener('hashchange', () => bukaHalaman(location.hash.slice(1)));

  // Buka halaman sesuai hash sekarang (default: dashboard)
  bukaHalaman(location.hash.slice(1) || 'dashboard');
});
