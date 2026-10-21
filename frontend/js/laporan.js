/* ==================================================================
   LAPORAN PENDAPATAN
   A. Pendapatan per akun (dari jurnal) -> total pendapatan periode
   B. Rincian pendapatan sewa lapangan per lapangan (dari booking selesai)
   C. Penerimaan & pengeluaran per metode (Kas / Bank / QRIS)
      -> bahan rekonsiliasi dengan uang di laci, rekening koran, laporan QRIS
   D. Saldo Pendapatan Diterima di Muka (uang diterima, belum diakui)
   Angka per akun diambil dari view v_mutasi_harian (dijumlah di server).
   ================================================================== */

function siapkanLaporan() {
  $('lp-dari').value = awalBulan();
  $('lp-sampai').value = hariIni();
  $('lp-tampil').addEventListener('click', muatLaporan);
  $('lp-cetak').addEventListener('click', () => window.print());
}

async function muatLaporan() {
  const dari = $('lp-dari').value;
  const sampai = $('lp-sampai').value;

  skeletonBlok('lp-isi', 320);     // kotak berkilau saat pertama kali dimuat (animasi.js)
  const [resAkun, resMutasi, resBooking, resPddm] = await Promise.all([
    db.from('akun').select('*').order('kode'),
    // ambilSemua: bisa lebih dari 1.000 baris (lihat app.js)
    ambilSemua(() => db.from('v_mutasi_harian').select('tanggal, akun_kode, kategori, debit, kredit')
      .gte('tanggal', dari).lte('tanggal', sampai).order('tanggal').order('akun_kode')),
    ambilSemua(() => db.from('v_booking_lengkap').select('id, nama_lapangan, durasi_jam, total_harga, pembelian_paket_id')
      .eq('status', 'selesai').gte('tanggal', dari).lte('tanggal', sampai).order('id')),
    ambilSemua(() => db.from('v_mutasi_harian').select('tanggal, debit, kredit')
      .eq('akun_kode', '2-101').lte('tanggal', sampai).order('tanggal'))
  ]);
  if (adaError(resAkun.error) || adaError(resMutasi.error) ||
      adaError(resBooking.error) || adaError(resPddm.error)) return;

  const mutasi = resMutasi.data;
  const akunPendapatan = resAkun.data.filter(a => a.kategori === 'Pendapatan');
  const akunKas = resAkun.data.filter(a => a.kode.startsWith('1-1'));

  // ---- A. Pendapatan per akun ----
  let totalPendapatan = 0;
  const barisAkun = akunPendapatan.map(akun => {
    const nilai = hitungSaldo(mutasi.filter(j => j.akun_kode === akun.kode), 'K');
    totalPendapatan += nilai;
    return `<tr><td>${esc(akun.kode)}</td><td>${esc(akun.nama)}</td><td class="angka">${rupiah(nilai)}</td></tr>`;
  }).join('');

  // ---- B. Rincian per lapangan ----
  const perLapangan = {};
  for (const b of resBooking.data) {
    const r = perLapangan[b.nama_lapangan] ??= { booking: 0, jam: 0, reguler: 0, member: 0 };
    r.booking += 1;
    r.jam += b.durasi_jam;
    if (b.pembelian_paket_id) r.member += Number(b.total_harga);
    else r.reguler += Number(b.total_harga);
  }
  const namaLapangan = Object.keys(perLapangan).sort();
  const total = { booking: 0, jam: 0, reguler: 0, member: 0 };
  const barisLapangan = namaLapangan.map(nama => {
    const r = perLapangan[nama];
    total.booking += r.booking; total.jam += r.jam; total.reguler += r.reguler; total.member += r.member;
    return `
      <tr>
        <td>${esc(nama)}</td>
        <td class="angka">${r.booking}</td>
        <td class="angka">${r.jam}</td>
        <td class="angka">${rupiah(r.reguler)}</td>
        <td class="angka">${rupiah(r.member)}</td>
        <td class="angka">${rupiah(r.reguler + r.member)}</td>
      </tr>`;
  }).join('');

  // ---- C. Penerimaan & pengeluaran per metode ----
  const totalMetode = { masuk: 0, keluar: 0 };
  const barisMetode = akunKas.map(akun => {
    const baris = mutasi.filter(j => j.akun_kode === akun.kode);
    const masuk = baris.reduce((t, j) => t + Number(j.debit), 0);
    const keluar = baris.reduce((t, j) => t + Number(j.kredit), 0);   // refund
    totalMetode.masuk += masuk; totalMetode.keluar += keluar;
    return `<tr><td>${esc(akun.kode)}</td><td>${esc(akun.nama)}</td>
      <td class="angka">${rupiah(masuk)}</td><td class="angka">${rupiah(keluar)}</td>
      <td class="angka">${rupiah(masuk - keluar)}</td></tr>`;
  }).join('');

  // ---- D. Saldo Pendapatan Diterima di Muka per tanggal "sampai" ----
  const saldoPddm = hitungSaldo(resPddm.data, 'K');

  $('lp-isi').innerHTML = `
    <div class="kop-laporan">
      <h3>SMASH PADEL CLUB</h3>
      <p><b>Laporan Pendapatan</b></p>
      <p>Periode ${tanggalIndo(dari)} s.d. ${tanggalIndo(sampai)}</p>
    </div>

    <h3>A. Pendapatan per Akun</h3>
    <div class="tabel-wrap">
      <table>
        <thead><tr><th>Kode</th><th>Akun</th><th class="angka">Jumlah</th></tr></thead>
        <tbody>${barisAkun}</tbody>
        <tfoot class="total"><tr><td colspan="2">TOTAL PENDAPATAN</td><td class="angka">${rupiah(totalPendapatan)}</td></tr></tfoot>
      </table>
    </div>

    <h3>B. Rincian Pendapatan Sewa Lapangan per Lapangan</h3>
    <div class="tabel-wrap">
      <table>
        <thead>
          <tr><th>Lapangan</th><th class="angka">Booking</th><th class="angka">Jam</th>
              <th class="angka">Reguler</th><th class="angka">Paket Member</th><th class="angka">Total</th></tr>
        </thead>
        <tbody>${barisLapangan || barisKosong(6, 'Belum ada booking selesai pada periode ini')}</tbody>
        <tfoot class="total">
          <tr>
            <td>TOTAL</td>
            <td class="angka">${total.booking}</td>
            <td class="angka">${total.jam}</td>
            <td class="angka">${rupiah(total.reguler)}</td>
            <td class="angka">${rupiah(total.member)}</td>
            <td class="angka">${rupiah(total.reguler + total.member)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <h3>C. Penerimaan &amp; Pengeluaran Kas per Metode</h3>
    <div class="tabel-wrap">
      <table>
        <thead><tr><th>Kode</th><th>Akun</th><th class="angka">Diterima</th>
          <th class="angka">Dikembalikan (refund)</th><th class="angka">Bersih</th></tr></thead>
        <tbody>${barisMetode}</tbody>
        <tfoot class="total"><tr><td colspan="2">TOTAL</td><td class="angka">${rupiah(totalMetode.masuk)}</td>
          <td class="angka">${rupiah(totalMetode.keluar)}</td><td class="angka">${rupiah(totalMetode.masuk - totalMetode.keluar)}</td></tr></tfoot>
      </table>
    </div>
    <p class="bantuan">Cocokkan baris Kas dengan uang tunai di laci, Bank dengan rekening koran,
      dan QRIS dengan laporan settlement penyedia QRIS.</p>

    <h3>D. Catatan</h3>
    <p>Saldo <b>Pendapatan Diterima di Muka</b> per ${tanggalIndo(sampai)}: <b>${rupiah(saldoPddm)}</b>.
      Jumlah ini adalah uang DP, pelunasan, dan paket member yang sudah diterima
      tetapi lapangannya belum dipakai, sehingga masih dicatat sebagai kewajiban
      (belum menjadi pendapatan). Penerimaan kas pada bagian C tidak sama dengan
      pendapatan pada bagian A karena pendapatan diakui saat jasa diberikan, bukan saat uang diterima.</p>`;
}
