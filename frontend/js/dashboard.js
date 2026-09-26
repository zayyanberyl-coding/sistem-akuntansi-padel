/* ==================================================================
   DASHBOARD
   1. Kartu hero      : foto lapangan + peralatan sewa (stok & tarif)
   2. Pendapatan      : bulan ini + perbandingan dengan bulan lalu
   3. Kas & diterima di muka
   4. Rincian pendapatan per akun
   5. Jadwal berikutnya
   6. Heatmap jam sibuk (30 hari terakhir)
   7. Grafik pemakaian lapangan (7 hari terakhir)
   ================================================================== */

// Foto peralatan dari Unsplash (lisensi gratis). Dipilih berdasarkan jenis.
const FOTO_RAKET = [
  'https://images.unsplash.com/photo-1657704358775-ed705c7388d2?w=300&h=300&fit=crop&crop=right&q=70&auto=format',
  'https://images.unsplash.com/photo-1658723826297-fe4d1b1e6600?w=300&h=300&fit=crop&crop=center&q=70&auto=format'
];
// Foto bola padel di atas lapangan biru
const FOTO_BOLA = 'https://images.unsplash.com/photo-1657704227277-04e8accd079e?w=300&h=300&fit=crop&q=70&auto=format';

const NAMA_HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

// Warna tiap akun pendapatan (sama di baris rincian & donut).
// Sudah diuji: tetap bisa dibedakan oleh penderita buta warna merah-hijau,
// dan kontras terhadap latar putih >= 3:1.
const WARNA_AKUN = {
  '4-101': '#0e7c5a',   // Sewa Lapangan   - hijau
  '4-102': '#c98314',   // Sewa Peralatan  - emas
  '4-103': '#3b7bd4',   // Denda           - biru
  '4-201': '#a7479a'    // Lain-lain       - ungu
};

async function muatDashboard() {
  const hari = hariIni();

  // Ambil semua data sekaligus (paralel) supaya lebih cepat
  const [resBooking, resJurnal, resAkun, resAlat, resLapangan] = await Promise.all([
    // ambilSemua: data bisa lebih dari 1.000 baris (lihat app.js)
    ambilSemua(() => db.from('v_booking_lengkap')
      .select('id, tanggal, jam_mulai, jam_selesai, durasi_jam, nama_pelanggan, nama_lapangan, status, pembelian_paket_id')
      .gte('tanggal', tambahHari(hari, -30)).lte('tanggal', tambahHari(hari, 14))
      .neq('status', 'batal').order('tanggal').order('jam_mulai').order('id')),
    ambilSemua(() => db.from('v_jurnal_lengkap')
      .select('id, akun_kode, kategori, tanggal, debit, kredit').order('id')),
    db.from('akun').select('*').eq('kategori', 'Pendapatan').order('kode'),
    db.from('peralatan').select('*').order('jenis', { ascending: false }).order('nama'),
    db.from('lapangan').select('id').eq('aktif', true)
  ]);
  if (adaError(resBooking.error) || adaError(resJurnal.error) || adaError(resAkun.error) ||
      adaError(resAlat.error) || adaError(resLapangan.error)) return;

  const booking = resBooking.data;
  const jurnal = resJurnal.data;

  tampilkanHero(resAlat.data, resLapangan.data.length);
  tampilkanKeuangan(jurnal, resAkun.data, hari);
  tampilkanTrenHarian(jurnal, hari);
  tampilkanJadwalBerikutnya(booking, hari);
  tampilkanHeatmap(booking, hari);
  tampilkanPemakaian(booking, hari);

  // Data sudah tampil: hapus efek skeleton (kotak berkilau)
  document.querySelectorAll('#page-dashboard .skeleton').forEach(el => el.classList.remove('skeleton'));
}

// ---------- 1. Kartu hero ----------
function tampilkanHero(peralatan, jumlahLapangan) {
  $('dash-info-lapangan').textContent = `${jumlahLapangan} lapangan aktif`;

  let nomorRaket = 0;
  $('dash-alat').innerHTML = peralatan.slice(0, 3).map(p => {
    const foto = p.jenis === 'bola' ? FOTO_BOLA : FOTO_RAKET[nomorRaket++ % FOTO_RAKET.length];
    return `
      <div class="alat">
        <div class="alat-foto" style="background-image: url('${foto}')">
          <span class="alat-stok ${p.stok < 5 ? 'rendah' : ''}" title="Stok">${p.stok}</span>
        </div>
        <b>${esc(p.nama)}</b>
        <span>${rupiah(p.tarif_sewa)} / sewa</span>
      </div>`;
  }).join('');
}

// ---------- 2-4. Pendapatan, kas, rincian ----------
function tampilkanKeuangan(jurnal, akunPendapatan, hari) {
  const bulanIni = hari.slice(0, 7);                         // contoh "2026-09"
  const awal = keDate(awalBulan());
  awal.setMonth(awal.getMonth() - 1);
  const bulanLalu = formatISO(awal).slice(0, 7);             // contoh "2026-08"

  const pendapatan = jurnal.filter(j => j.kategori === 'Pendapatan');
  const barisBulanIni = pendapatan.filter(j => j.tanggal.startsWith(bulanIni));
  const totalBulanIni = hitungSaldo(barisBulanIni, 'K');
  const totalBulanLalu = hitungSaldo(pendapatan.filter(j => j.tanggal.startsWith(bulanLalu)), 'K');

  // animasiAngka: angka menghitung naik dari nilai sebelumnya (lihat animasi.js)
  animasiAngka($('dash-pendapatan-bulan'), totalBulanIni, rupiah);
  $('dash-tren-pendapatan').outerHTML = teksTren(totalBulanIni, totalBulanLalu, 'bulan lalu', 'dash-tren-pendapatan');

  animasiAngka($('dash-kas'),  hitungSaldo(jurnal.filter(j => j.akun_kode === '1-101'), 'D'), rupiah);
  animasiAngka($('dash-pddm'), hitungSaldo(jurnal.filter(j => j.akun_kode === '2-101'), 'K'), rupiah);

  // Rincian per akun + persentase dari total pendapatan bulan ini
  $('dash-bulan-label').textContent =
    keDate(hari).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) + ' (s.d. hari ini)';
  const perAkun = akunPendapatan.map(a => ({
    kode: a.kode,
    nama: a.nama.replace('Pendapatan ', ''),
    nilai: hitungSaldo(barisBulanIni.filter(j => j.akun_kode === a.kode), 'K'),
    warna: WARNA_AKUN[a.kode] || '#888780'   // abu-abu untuk akun baru yang belum diberi warna
  }));
  perAkun.forEach(a => { a.persen = totalBulanIni > 0 ? (a.nilai / totalBulanIni) * 100 : 0; });

  // Baris rincian (sekaligus legenda donut)
  $('dash-grafik').innerHTML = perAkun.map(a => `
    <div class="rincian-baris" data-kode="${a.kode}">
      <div class="rincian-atas">
        <i class="titik" style="background:${a.warna}"></i>
        <span>${esc(a.nama)}</span>
        <b>${rupiah(a.nilai)}</b>
        <em>${formatPersen(a.persen)}</em>
      </div>
      <div class="rincian-batang"><i style="width:${a.persen}%; background:${a.warna}"></i></div>
    </div>`).join('');

  gambarDonut(perAkun, totalBulanIni);
}

// ---------- Tren pendapatan harian (30 hari) ----------
let trenData = [];                 // disimpan supaya grafik bisa digambar ulang saat layar diubah ukurannya
let trenSudahPasangResize = false;

function tampilkanTrenHarian(jurnal, hari) {
  // Jumlahkan pendapatan (kredit - debit akun Pendapatan) per tanggal
  const perTanggal = {};
  for (const j of jurnal) {
    if (j.kategori !== 'Pendapatan') continue;
    perTanggal[j.tanggal] = (perTanggal[j.tanggal] || 0) + Number(j.kredit) - Number(j.debit);
  }
  trenData = [];
  for (let i = 29; i >= 0; i--) {
    const tgl = tambahHari(hari, -i);
    trenData.push({ tgl, nilai: perTanggal[tgl] || 0 });
  }

  const total = trenData.reduce((t, d) => t + d.nilai, 0);
  const terbaik = trenData.reduce((a, b) => (b.nilai > a.nilai ? b : a), trenData[0]);
  $('dash-rata-harian').textContent = rupiahSingkat(total / trenData.length);
  $('dash-hari-terbaik').textContent = terbaik.nilai > 0
    ? `${rupiahSingkat(terbaik.nilai)} · ${tanggalIndo(terbaik.tgl).slice(0, 6)}` : '-';

  gambarSparkline(true);   // true = dengan animasi garis "digambar"
  if (!trenSudahPasangResize) {
    window.addEventListener('resize', () => gambarSparkline(false));
    trenSudahPasangResize = true;
  }
}

// Menggambar grafik garis + area dengan SVG, memakai ukuran piksel wadahnya
function gambarSparkline(animasi) {
  const wadah = $('dash-sparkline');
  if (!wadah || !trenData.length || !wadah.clientWidth) return;

  const W = wadah.clientWidth;
  const H = wadah.clientHeight;
  const ATAS = 8, BAWAH = 18, KIRI = 2, KANAN = 2;   // ruang untuk label tanggal di bawah
  const maks = Math.max(...trenData.map(d => d.nilai), 1);
  const x = (i) => KIRI + (i * (W - KIRI - KANAN)) / (trenData.length - 1);
  const y = (v) => ATAS + (1 - v / maks) * (H - ATAS - BAWAH);

  const titik = trenData.map((d, i) => `${x(i).toFixed(1)},${y(d.nilai).toFixed(1)}`);
  const garis = 'M' + titik.join(' L');
  const area = `${garis} L${x(trenData.length - 1)},${H - BAWAH} L${x(0)},${H - BAWAH} Z`;
  const labelTgl = (i, anchor) =>
    `<text class="label-sumbu" x="${x(i)}" y="${H - 3}" text-anchor="${anchor}">${tanggalIndo(trenData[i].tgl).slice(0, 6)}</text>`;

  wadah.innerHTML = `
    <svg aria-label="Grafik pendapatan harian 30 hari terakhir" role="img">
      <line x1="0" x2="${W}" y1="${H - BAWAH}" y2="${H - BAWAH}" stroke="var(--garis-tebal)" />
      <path d="${area}" fill="var(--aksen-muda)" class="${animasi ? 'area-animasi' : ''}" />
      <!-- pathLength="1": panjang garis dianggap 1, supaya animasi "digambar" mudah diatur di CSS -->
      <path d="${garis}" fill="none" stroke="var(--aksen)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
            pathLength="1" class="${animasi ? 'garis-animasi' : ''}" />
      ${labelTgl(0, 'start')}${labelTgl(14, 'middle')}${labelTgl(29, 'end')}
      <g id="spark-hover" visibility="hidden">
        <line class="garis-bantu" id="spark-garis" y1="${ATAS}" y2="${H - BAWAH}" />
        <circle id="spark-titik" r="4.5" fill="var(--aksen)" stroke="#fff" stroke-width="2" />
      </g>
    </svg>
    <div class="sparkline-tip" id="spark-tip" hidden></div>`;

  // Hover: cari hari terdekat dari posisi kursor, tampilkan garis bantu & tooltip
  const hover = $('spark-hover'), tip = $('spark-tip');
  wadah.onmousemove = (e) => {
    const kotak = wadah.getBoundingClientRect();
    const i = Math.round(((e.clientX - kotak.left - KIRI) / (W - KIRI - KANAN)) * (trenData.length - 1));
    const d = trenData[Math.max(0, Math.min(trenData.length - 1, i))];
    const idx = trenData.indexOf(d);
    $('spark-garis').setAttribute('x1', x(idx));
    $('spark-garis').setAttribute('x2', x(idx));
    $('spark-titik').setAttribute('cx', x(idx));
    $('spark-titik').setAttribute('cy', y(d.nilai));
    hover.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `${tanggalIndo(d.tgl)}<b>${rupiah(d.nilai)}</b>`;
    // Tooltip tepat di atas titik (atau di bawahnya jika tidak muat),
    // dan dijaga agar tidak keluar dari kartu
    const lebarTip = tip.offsetWidth, tinggiTip = tip.offsetHeight;
    const yTitik = y(d.nilai);
    tip.style.left = Math.min(Math.max(x(idx), lebarTip / 2), W - lebarTip / 2) + 'px';
    tip.style.top = (yTitik - tinggiTip - 10 >= 0 ? yTitik - tinggiTip - 10 : yTitik + 12) + 'px';
  };
  wadah.onmouseleave = () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
}

// "86,2%" (1 desimal), atau "<0,1%" untuk nilai sangat kecil
function formatPersen(p) {
  if (p > 0 && p < 0.1) return '<0,1%';
  return p.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%';
}

// Rp 126.415.000 -> "Rp 126,4 jt" (untuk tengah donut yang sempit)
function rupiahSingkat(n) {
  if (n >= 1e9) return 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (n >= 1e6) return 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  return rupiah(n);
}

// ---------- Diagram donut sumber pendapatan ----------
// Trik SVG: lingkaran dengan keliling 100 satuan (r = 15,915), sehingga
// panjang garis (stroke-dasharray) bisa langsung diisi dengan persen.
function gambarDonut(perAkun, total) {
  const wadah = $('dash-donut');
  const ada = perAkun.filter(a => a.nilai > 0);
  if (total <= 0 || ada.length === 0) {
    wadah.innerHTML = '<p class="bantuan">Belum ada pendapatan bulan ini.</p>';
    return;
  }

  const CELAH = ada.length > 1 ? 0.6 : 0;   // celah putih tipis antar-irisan
  let posisi = 0;
  const irisan = ada.map(a => {
    const panjang = Math.max(a.persen - CELAH, 0.3);   // irisan kecil tetap terlihat
    const html = `<circle class="irisan" data-kode="${a.kode}" cx="21" cy="21" r="15.915"
                    fill="none" stroke="${a.warna}" stroke-width="5.2"
                    style="stroke-dasharray: 0 100" data-panjang="${panjang}" stroke-dashoffset="${-posisi}">
                    <title>${esc(a.nama)}: ${rupiah(a.nilai)} (${formatPersen(a.persen)})</title>
                  </circle>`;
    posisi += a.persen;
    return html;
  }).join('');

  const teksTengah = `<small>Total bulan ini</small><strong>${rupiahSingkat(total)}</strong>`;
  wadah.innerHTML = `
    <div class="donut" role="img" aria-label="Diagram sumber pendapatan bulan ini">
      <svg viewBox="0 0 42 42">${irisan}</svg>
      <div class="donut-tengah" id="dash-donut-tengah">${teksTengah}</div>
    </div>`;

  // Animasi donut "terisi": irisan mulai dari panjang 0, lalu (di frame berikutnya)
  // diubah ke panjang aslinya sehingga CSS transition menganimasikannya
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wadah.querySelectorAll('.irisan').forEach(c => {
      const p = Number(c.dataset.panjang);
      c.style.strokeDasharray = `${p} ${100 - p}`;
    });
  }));

  // Sorot irisan saat kursor di atas donut ATAU di atas baris rincian
  const donut = wadah.querySelector('.donut');
  const rincian = $('dash-grafik');
  const sorot = (kode) => {
    const a = perAkun.find(x => x.kode === kode);
    donut.classList.toggle('sorot', !!a);
    rincian.classList.toggle('dash-rincian-redup', !!a);
    donut.querySelectorAll('.irisan').forEach(c => c.classList.toggle('aktif', c.dataset.kode === kode));
    rincian.querySelectorAll('.rincian-baris').forEach(r => r.classList.toggle('aktif', r.dataset.kode === kode));
    $('dash-donut-tengah').innerHTML = a
      ? `<small>${esc(a.nama)}</small><strong>${formatPersen(a.persen)}</strong><small>${rupiahSingkat(a.nilai)}</small>`
      : teksTengah;
  };
  donut.querySelectorAll('.irisan').forEach(c => {
    c.addEventListener('mouseenter', () => sorot(c.dataset.kode));
    c.addEventListener('mouseleave', () => sorot(null));
  });
  rincian.querySelectorAll('.rincian-baris').forEach(r => {
    r.addEventListener('mouseenter', () => sorot(r.dataset.kode));
    r.addEventListener('mouseleave', () => sorot(null));
  });
}

// Teks perbandingan, contoh: "▲ 12% vs bulan lalu"
function teksTren(sekarang, sebelumnya, label, id) {
  if (!sebelumnya) {
    return `<div class="tren" id="${id}">Belum ada data ${label} untuk dibandingkan</div>`;
  }
  const persen = Math.round(((sekarang - sebelumnya) / sebelumnya) * 100);
  const naik = persen >= 0;
  return `<div class="tren ${naik ? '' : 'turun'}" id="${id}">
            <i class="ti ti-trending-${naik ? 'up' : 'down'}"></i>
            <b>${Math.abs(persen)}%</b> vs ${label}
          </div>`;
}

// ---------- 5. Jadwal berikutnya ----------
function tampilkanJadwalBerikutnya(booking, hari) {
  animasiAngka($('dash-booking-hari-ini'), booking.filter(b => b.tanggal === hari).length);

  const berikutnya = booking
    .filter(b => b.tanggal >= hari && ['menunggu', 'dp', 'lunas'].includes(b.status))
    .slice(0, 5);   // data sudah urut tanggal & jam dari query

  $('dash-jadwal').innerHTML = berikutnya.length === 0
    ? '<p class="bantuan">Belum ada jadwal ke depan.</p>'
    : berikutnya.map(b => {
        // Inisial nama, contoh "Nadia Putri" -> "NP"
        const inisial = b.nama_pelanggan.split(' ').map(k => k[0]).slice(0, 2).join('').toUpperCase();
        const kapan = b.tanggal === hari ? 'Hari ini' : tanggalIndo(b.tanggal);
        return `
          <div class="sesi">
            <span class="avatar ${b.pembelian_paket_id ? 'emas' : ''}"
                  title="${b.pembelian_paket_id ? 'Member' : 'Reguler'}">${esc(inisial)}</span>
            <div>
              <b>${esc(b.nama_pelanggan)}</b>
              ${kapan} · ${jam(b.jam_mulai)}–${jam(b.jam_selesai)} · ${esc(b.nama_lapangan)}
            </div>
          </div>`;
      }).join('');
}

// ---------- 6. Heatmap jam sibuk ----------
function tampilkanHeatmap(booking, hari) {
  const dari = tambahHari(hari, -29);
  const data = booking.filter(b => b.tanggal >= dari && b.tanggal <= hari);

  // hitung[hari 0-6][jam 0-15] = berapa kali jam itu dipakai
  const hitung = NAMA_HARI.map(() => Array(JAM_TUTUP - JAM_BUKA).fill(0));
  for (const b of data) {
    const indeksHari = (keDate(b.tanggal).getDay() + 6) % 7;   // Senin = 0 ... Minggu = 6
    const mulai = parseInt(b.jam_mulai);
    for (let j = mulai; j < mulai + b.durasi_jam; j++) hitung[indeksHari][j - JAM_BUKA]++;
  }

  const maks = Math.max(...hitung.flat(), 1);
  let puncak = { nilai: 0 };

  // Baris judul jam (ditulis tiap 2 jam supaya tidak sesak)
  let html = '<span></span>';
  for (let j = JAM_BUKA; j < JAM_TUTUP; j++) {
    html += `<span class="jam-label">${(j - JAM_BUKA) % 2 === 0 ? String(j).padStart(2, '0') : ''}</span>`;
  }
  hitung.forEach((baris, h) => {
    html += `<span class="hari">${NAMA_HARI[h]}</span>`;
    baris.forEach((nilai, k) => {
      const level = nilai === 0 ? 0 : Math.ceil((nilai / maks) * 4);   // 1..4
      if (nilai > puncak.nilai) puncak = { nilai, hari: NAMA_HARI[h], jam: jamKeTeks(k + JAM_BUKA) };
      // --urutan membuat sel muncul bergelombang dari kiri-atas ke kanan-bawah
      html += `<span class="sel ${level ? 'l' + level : ''}" style="--urutan:${k + h}"
                     title="${NAMA_HARI[h]} ${jamKeTeks(k + JAM_BUKA)}: ${nilai}x"></span>`;
    });
  });
  $('dash-heatmap').innerHTML = html;

  animasiAngka($('dash-total-jam'), data.reduce((t, b) => t + b.durasi_jam, 0));
  $('dash-jam-puncak').innerHTML = puncak.nilai
    ? `<i class="ti ti-flame"></i> Paling ramai: <b>${puncak.hari} ${puncak.jam}</b>`
    : 'Belum ada booking dalam 30 hari terakhir';
}

// ---------- 7. Pemakaian lapangan 7 hari terakhir ----------
function tampilkanPemakaian(booking, hari) {
  const jamPadaTanggal = (tgl) => booking.filter(b => b.tanggal === tgl).reduce((t, b) => t + b.durasi_jam, 0);

  const tujuhHari = [];
  for (let i = 6; i >= 0; i--) {
    const tgl = tambahHari(hari, -i);
    tujuhHari.push({ tgl, jam: jamPadaTanggal(tgl) });
  }
  let mingguLalu = 0;
  for (let i = 13; i >= 7; i--) mingguLalu += jamPadaTanggal(tambahHari(hari, -i));

  const total = tujuhHari.reduce((t, d) => t + d.jam, 0);
  animasiAngka($('dash-jam-minggu'), total);
  $('dash-tren-minggu').outerHTML = teksTren(total, mingguLalu, '7 hari sebelumnya', 'dash-tren-minggu');

  const maks = Math.max(...tujuhHari.map(d => d.jam), 1);
  $('dash-batang').innerHTML = tujuhHari.map((d, i) => {
    const puncak = d.jam === maks && d.jam > 0;
    return `
      <div class="batang ${puncak ? 'puncak' : ''}" title="${tanggalIndo(d.tgl)}: ${d.jam} jam">
        ${puncak ? `<em>${d.jam}j</em>` : ''}
        <i style="height:${(d.jam / maks) * 75}%; --urutan:${i}"></i>
        ${NAMA_HARI[(keDate(d.tgl).getDay() + 6) % 7]}
      </div>`;
  }).join('');
}
