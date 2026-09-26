/* ==================================================================
   ANIMASI & INTERAKSI
   Fungsi-fungsi kecil untuk membuat tampilan terasa "hidup":
     1. animasiMasukHalaman : kartu/panel muncul berurutan saat pindah menu
     2. geserIndikatorMenu  : pil hijau di sidebar meluncur ke menu aktif
     3. animasiAngka        : angka menghitung naik (count-up)
     4. mulaiMemuat         : tombol Simpan menampilkan putaran loading
     5. getarkan            : form bergetar pelan saat ditolak
     6. sorotBaris          : baris/slot baru berkedip hijau sesaat
     7. skeletonTabel       : kotak abu-abu berkilau selama data dimuat

   Semua animasi dimatikan otomatis jika pengguna menyalakan pengaturan
   "kurangi gerakan" (prefers-reduced-motion) di sistem operasinya.
   ================================================================== */

// true jika pengguna ingin gerakan dikurangi
const kurangiGerakan = window.matchMedia('(prefers-reduced-motion: reduce)');

// Tambah class animasi lalu hapus lagi setelah selesai,
// supaya tidak "mengunci" efek hover (transform) sesudahnya.
function jalankanAnimasi(el, namaClass) {
  el.classList.remove(namaClass);
  void el.offsetWidth;                       // paksa browser mengulang animasi
  el.classList.add(namaClass);
  el.addEventListener('animationend', () => el.classList.remove(namaClass), { once: true });
}

// ---------- 1. Kartu muncul berurutan ----------
function animasiMasukHalaman(section) {
  if (!section || kurangiGerakan.matches) return;
  const WADAH_GRID = '.dua-kolom, .tiga-kolom, .kolom-booking, .dash-grid';
  const target = [];
  for (const anak of section.children) {
    if (anak.tagName === 'DIALOG') continue;
    // Jika anak berupa grid, yang dianimasikan kartu-kartu di dalamnya
    if (anak.matches(WADAH_GRID)) target.push(...anak.children);
    else target.push(anak);
  }
  target.forEach((el, i) => {
    el.style.setProperty('--urutan', Math.min(i, 8));   // jeda maksimal 8 x 60 ms
    jalankanAnimasi(el, 'muncul');
  });
}

// ---------- 2. Indikator menu sidebar ----------
function geserIndikatorMenu() {
  const indikator = $('menu-indikator');
  const aktif = document.querySelector('.menu a.aktif');
  if (!indikator) return;
  if (!aktif) { indikator.style.opacity = 0; return; }
  indikator.style.opacity = 1;
  indikator.style.height = aktif.offsetHeight + 'px';
  indikator.style.transform = `translateY(${aktif.offsetTop}px)`;
  // Posisi pertama langsung (tanpa meluncur), berikutnya baru meluncur
  requestAnimationFrame(() => indikator.classList.add('siap'));
}
window.addEventListener('resize', geserIndikatorMenu);

// ---------- 3. Angka menghitung naik ----------
//   el     : elemen tempat angka ditulis
//   nilai  : angka tujuan
//   format : fungsi pengubah angka jadi teks, contoh rupiah
function animasiAngka(el, nilai, format = (n) => String(n)) {
  const awal = Number(el.dataset.nilai || 0);   // angka sebelumnya (0 saat pertama kali)
  el.dataset.nilai = nilai;
  if (kurangiGerakan.matches || awal === nilai) {
    el.textContent = format(nilai);
    return;
  }
  const DURASI = 800;
  const mulai = performance.now();
  const langkah = (sekarang) => {
    const p = Math.min((sekarang - mulai) / DURASI, 1);
    const halus = 1 - Math.pow(1 - p, 3);          // cepat di awal, melambat di akhir
    el.textContent = format(Math.round(awal + (nilai - awal) * halus));
    if (p < 1) requestAnimationFrame(langkah);
  };
  requestAnimationFrame(langkah);
}

// ---------- 4 & 5. Tombol loading + getar saat gagal ----------
// Dipakai di awal fungsi submit:
//   const selesai = mulaiMemuat(e);
//   ... await simpan ke Supabase ...
//   selesai(adaError(error));      // true = gagal -> form bergetar
function mulaiMemuat(e) {
  const form = e.target;
  const tombol = e.submitter || form.querySelector('[type="submit"]');
  if (tombol) {
    tombol.classList.add('memuat');
    tombol.disabled = true;           // cegah klik dua kali
  }
  return (gagal) => {
    if (tombol) {
      tombol.classList.remove('memuat');
      tombol.disabled = false;
    }
    if (gagal) getarkan(form);
  };
}

function getarkan(el) {
  if (!el || kurangiGerakan.matches) return;
  jalankanAnimasi(el, 'getar');
}

// ---------- 6. Sorot baris / slot yang baru disimpan ----------
//   selector : contoh '#bk-daftar tr[data-id="12"]'
function sorotBaris(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: kurangiGerakan.matches ? 'auto' : 'smooth', block: 'nearest' });
  jalankanAnimasi(el, el.tagName === 'TD' ? 'pop' : 'baris-baru');
}

// ---------- 7. Skeleton loading untuk tabel ----------
// Hanya ditampilkan saat tabel masih kosong (pertama kali dibuka),
// supaya tidak berkedip setiap kali data dimuat ulang.
function skeletonTabel(idTbody, jumlahKolom, jumlahBaris = 4) {
  const tbody = $(idTbody);
  if (!tbody || tbody.children.length) return;
  const sel = '<td><span class="skeleton"></span></td>'.repeat(jumlahKolom);
  tbody.innerHTML = `<tr class="skeleton-baris">${sel}</tr>`.repeat(jumlahBaris);
}

// Skeleton untuk wadah <div> (misal Buku Besar & Laporan)
function skeletonBlok(idWadah, tinggi = 160) {
  const wadah = $(idWadah);
  if (!wadah || wadah.children.length) return;
  wadah.innerHTML = `<div class="skeleton skeleton-blok" style="height:${tinggi}px"></div>`;
}
