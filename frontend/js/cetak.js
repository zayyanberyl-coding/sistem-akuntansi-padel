/* ==================================================================
   CETAK DOKUMEN TRANSAKSI
   1. Konfirmasi Booking : bukti pemesanan untuk pelanggan
   2. Kwitansi           : bukti penerimaan pembayaran (DP / pelunasan)
   Dokumen dibuat di <div id="area-cetak">, lalu window.print().
   Saat mencetak, hanya area ini yang tampil (lihat CSS body.mode-cetak).
   ================================================================== */

// Angka -> kata, contoh 150000 -> "seratus lima puluh ribu"
function terbilang(n) {
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 12) return satuan[n];
  if (n < 20) return terbilang(n - 10) + ' belas';
  if (n < 100) return terbilang(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + terbilang(n % 10) : '');
  if (n < 200) return 'seratus' + (n > 100 ? ' ' + terbilang(n - 100) : '');
  if (n < 1000) return terbilang(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
  if (n < 2000) return 'seribu' + (n > 1000 ? ' ' + terbilang(n - 1000) : '');
  if (n < 1e6) return terbilang(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
  if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilang(n % 1e6) : '');
  return terbilang(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilang(n % 1e9) : '');
}

// Tampilkan dokumen lalu buka dialog cetak browser
function cetakDokumen(html) {
  const area = $('area-cetak');
  area.innerHTML = html;
  area.hidden = false;
  document.body.classList.add('mode-cetak');
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('mode-cetak');
    area.hidden = true;
  }, { once: true });
  window.print();
}

const KOP = `
  <div class="dok-kop">
    <img src="img/logo.svg" alt="">
    <div><strong>SMASH PADEL CLUB</strong><span>Sistem Akuntansi Pendapatan Sewa Lapangan</span></div>
  </div>`;

function barisDok(label, isi) {
  return `<tr><th>${label}</th><td>${isi}</td></tr>`;
}

// ---------- 1. Konfirmasi Booking ----------
async function cetakKonfirmasiBooking(idBooking) {
  const [resB, resBayar] = await Promise.all([
    db.from('v_booking_lengkap').select('*').eq('id', idBooking).single(),
    db.from('pembayaran').select('tanggal, jenis, jumlah, metode_bayar').eq('booking_id', idBooking).order('id')
  ]);
  if (adaError(resB.error) || adaError(resBayar.error)) return;
  const b = resB.data;

  const daftarBayar = resBayar.data.length === 0 ? '<tr><td colspan="4">Belum ada pembayaran</td></tr>'
    : resBayar.data.map(p => `<tr><td>${tanggalIndo(p.tanggal)}</td><td>${esc(p.jenis)}</td>
        <td>${esc(p.metode_bayar)}</td><td class="angka">${rupiah(p.jumlah)}</td></tr>`).join('');

  cetakDokumen(`
    ${KOP}
    <h2 class="dok-judul">KONFIRMASI BOOKING</h2>
    <p class="dok-nomor">No. ${esc(b.kode_booking)} · dicetak ${tanggalIndo(hariIni())}</p>
    <table class="dok-info">
      ${barisDok('Pelanggan', esc(b.nama_pelanggan) + (b.no_hp ? ' (' + esc(b.no_hp) + ')' : ''))}
      ${barisDok('Lapangan', esc(b.nama_lapangan))}
      ${barisDok('Jadwal', tanggalPanjang(b.tanggal) + ', ' + jam(b.jam_mulai) + '–' + jam(b.jam_selesai) + ' (' + b.durasi_jam + ' jam)')}
      ${barisDok('Jenis tarif', esc(b.jenis_tarif))}
      ${barisDok('Status', esc(b.status))}
    </table>
    <table class="dok-tabel">
      <thead><tr><th>Tanggal bayar</th><th>Jenis</th><th>Metode</th><th class="angka">Jumlah</th></tr></thead>
      <tbody>${daftarBayar}</tbody>
      <tfoot>
        <tr><td colspan="3">Total tagihan</td><td class="angka">${rupiah(b.total_harga)}</td></tr>
        <tr><td colspan="3">Sudah dibayar</td><td class="angka">${rupiah(b.pembelian_paket_id ? b.total_harga : b.total_dibayar)}</td></tr>
        <tr><td colspan="3"><b>Sisa tagihan</b></td><td class="angka"><b>${rupiah(b.sisa_tagihan)}</b></td></tr>
      </tfoot>
    </table>
    ${b.pembelian_paket_id ? '<p class="dok-catatan">Dibayar dengan paket member.</p>' : ''}
    <p class="dok-catatan">Ketentuan pembatalan: pembatalan oleh pelanggan ≥ 24 jam sebelum jadwal main mendapat
      pengembalian dana penuh; pembatalan &lt; 24 jam sebelum jadwal, uang yang telah dibayar tidak dapat dikembalikan.
      Pembatalan oleh klub selalu dikembalikan penuh.</p>
    <p class="dok-catatan">Data pribadi pelanggan (nama dan nomor HP) hanya digunakan untuk keperluan pemesanan
      dan pencatatan transaksi, tidak dibagikan kepada pihak lain, dan hanya dapat diakses oleh petugas klub.
      Perbaikan data dapat diajukan melalui petugas.</p>
    <div class="dok-ttd"><span>Petugas,</span><span>${esc(penggunaAktif?.nama || '')}</span></div>`);
}

// ---------- 2. Kwitansi Pembayaran ----------
async function cetakKwitansi(idPembayaran) {
  const { data: p, error } = await db.from('v_pembayaran_lengkap').select('*').eq('id', idPembayaran).single();
  if (adaError(error)) return;

  const nomor = 'KW-' + String(p.id).padStart(5, '0');
  const kata = terbilang(p.jumlah);

  cetakDokumen(`
    ${KOP}
    <h2 class="dok-judul">KWITANSI</h2>
    <p class="dok-nomor">No. ${nomor} · ${tanggalIndo(p.tanggal)}</p>
    <table class="dok-info">
      ${barisDok('Telah terima dari', esc(p.nama_pelanggan))}
      ${barisDok('Uang sejumlah', '<b>' + rupiah(p.jumlah) + '</b>')}
      ${barisDok('Terbilang', '<i>' + kata.charAt(0).toUpperCase() + kata.slice(1) + ' rupiah</i>')}
      ${barisDok('Untuk pembayaran', (p.jenis === 'dp' ? 'Uang muka (DP)' : 'Pelunasan') + ' sewa lapangan ' + esc(p.nama_lapangan)
        + ', booking ' + esc(p.kode_booking) + ' — ' + tanggalIndo(p.tanggal_main) + ' ' + jam(p.jam_mulai) + '–' + jam(p.jam_selesai))}
      ${barisDok('Metode', esc(p.metode_bayar))}
    </table>
    <p class="dok-catatan">Pembayaran ini dicatat sebagai Pendapatan Diterima di Muka dan diakui sebagai pendapatan
      setelah lapangan selesai digunakan.</p>
    <div class="dok-ttd"><span>Penerima,</span><span>${esc(p.nama_pembuat || penggunaAktif?.nama || '')}</span></div>`);
}
