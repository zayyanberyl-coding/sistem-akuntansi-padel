/* ==================================================================
   PEMBAYARAN
   Menerima DP / pelunasan untuk booking reguler.
   Jurnal otomatis (trigger): Kas/Bank/QRIS sesuai metode (D) /
   Pendapatan Diterima di Muka (K).
   Status booking otomatis berubah jadi 'dp' atau 'lunas'.
   Tanggal tidak boleh di masa depan; mundur > 3 hari hanya owner (dijaga database).
   Bagian bawah: settlement QRIS (pencairan Saldo QRIS ke Bank + biaya MDR), owner saja.
   ================================================================== */

let byDaftarBooking = [];                 // booking yang belum lunas
let pembayaranBookingTerpilih = null;     // diisi dari tombol "Bayar" di halaman Booking

function siapkanPembayaran() {
  $('by-tanggal').value = hariIni();
  $('by-tanggal').max = hariIni();                                       // tidak boleh masa depan
  if (!adalahOwner()) $('by-tanggal').min = tambahHari(hariIni(), -3);   // admin maks. mundur 3 hari
  $('by-booking').addEventListener('change', tampilkanInfoTagihan);

  // Tombol kwitansi di riwayat pembayaran
  $('by-daftar').addEventListener('click', (e) => {
    const tombol = e.target.closest('button[data-kwitansi]');
    if (tombol) cetakKwitansi(Number(tombol.dataset.kwitansi));   // cetak.js
  });

  // Tombol cepat: isi 50% (DP) atau seluruh sisa (pelunasan)
  $('by-isi-dp').addEventListener('click', () => {
    const b = bookingTerpilih();
    if (b) $('by-jumlah').value = Math.min(Math.round(b.total_harga / 2), b.sisa_tagihan);
  });
  $('by-isi-lunas').addEventListener('click', () => {
    const b = bookingTerpilih();
    if (b) $('by-jumlah').value = b.sisa_tagihan;
  });

  $('form-pembayaran').addEventListener('submit', simpanPembayaran);

  // Settlement QRIS (khusus owner; aturan sebenarnya dijaga database)
  $('st-tanggal').value = hariIni();
  $('st-tanggal').max = hariIni();
  $('st-bruto').addEventListener('input', tampilkanInfoSettlement);
  $('st-bersih').addEventListener('input', tampilkanInfoSettlement);
  $('form-settlement').addEventListener('submit', simpanSettlement);
}

async function muatPembayaran() {
  // Booking reguler yang masih punya tagihan
  const { data, error } = await db.from('v_booking_lengkap').select('*')
    .in('status', ['menunggu', 'dp']).is('pembelian_paket_id', null)
    .order('tanggal').order('jam_mulai');
  if (adaError(error)) return;
  byDaftarBooking = data;

  isiSelect($('by-booking'), data, b => b.id,
    b => `${b.kode_booking} • ${b.nama_pelanggan} • ${tanggalIndo(b.tanggal)} ${jam(b.jam_mulai)} • sisa ${rupiah(b.sisa_tagihan)}`,
    data.length ? '-- pilih booking --' : 'Tidak ada booking yang perlu dibayar');

  // Jika datang dari tombol "Bayar" di halaman Booking
  if (pembayaranBookingTerpilih) {
    $('by-booking').value = pembayaranBookingTerpilih;
    pembayaranBookingTerpilih = null;
  }
  tampilkanInfoTagihan();
  await Promise.all([muatRiwayatPembayaran(), muatSettlement()]);
}

function bookingTerpilih() {
  return byDaftarBooking.find(b => String(b.id) === $('by-booking').value);
}

function tampilkanInfoTagihan() {
  const b = bookingTerpilih();
  const el = $('by-info');
  if (!b) {
    el.textContent = 'Pilih booking terlebih dahulu.';
    $('by-jumlah').value = '';
    return;
  }
  el.innerHTML = `
    ${esc(b.nama_lapangan)}, ${tanggalIndo(b.tanggal)} ${jam(b.jam_mulai)}–${jam(b.jam_selesai)} (${esc(b.jenis_tarif)})<br>
    Total tagihan: <b>${rupiah(b.total_harga)}</b><br>
    Sudah dibayar: ${rupiah(b.total_dibayar)}<br>
    Sisa tagihan: <b>${rupiah(b.sisa_tagihan)}</b> &nbsp; ${badge(b.status)}`;
  $('by-jumlah').max = b.sisa_tagihan;
}

async function simpanPembayaran(e) {
  e.preventDefault();
  const b = bookingTerpilih();
  const jumlah = Number($('by-jumlah').value);
  if (!b) {
    getarkan(e.target);
    return tampilkanPesan('Pilih booking terlebih dahulu.', 'error');
  }
  if (jumlah <= 0 || jumlah > b.sisa_tagihan) {
    getarkan(e.target);
    return tampilkanPesan(`Jumlah harus antara 1 dan ${rupiah(b.sisa_tagihan)}.`, 'error');
  }

  const selesai = mulaiMemuat(e);   // tombol berputar (animasi.js)
  const { data, error } = await db.from('pembayaran').insert({
    booking_id: b.id,
    tanggal: $('by-tanggal').value,
    jumlah: jumlah,
    metode_bayar: $('by-metode').value
    // kolom "jenis" (dp / pelunasan) diisi otomatis oleh trigger
  }).select().single();
  const gagal = adaError(error);
  selesai(gagal);
  if (gagal) return;

  tampilkanPesan(data.jenis === 'pelunasan'
    ? `Booking ${b.kode_booking} LUNAS. Jurnal Kas / Pendapatan Diterima di Muka tercatat.`
    : `DP ${rupiah(jumlah)} untuk ${b.kode_booking} tercatat.`);
  $('by-jumlah').value = '';
  await muatPembayaran();
  sorotBaris(`#by-daftar tr[data-id="${data.id}"]`);   // baris baru berkedip hijau
}

async function muatRiwayatPembayaran() {
  skeletonTabel('by-daftar', 8);
  const { data, error } = await db.from('v_pembayaran_lengkap').select('*')
    .order('tanggal', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (adaError(error)) return;

  $('by-daftar').innerHTML = data.length === 0 ? barisKosong(8) : data.map(p => `
    <tr data-id="${p.id}">
      <td>${tanggalIndo(p.tanggal)}</td>
      <td>${esc(p.kode_booking)}</td>
      <td>${esc(p.nama_pelanggan)}</td>
      <td>${badge(p.jenis)}</td>
      <td>${esc(p.metode_bayar)}</td>
      <td class="angka">${rupiah(p.jumlah)}</td>
      <td><small class="abu">${esc(p.nama_pembuat || 'data contoh')}</small></td>
      <td><button class="tombol tombol-kecil" data-kwitansi="${p.id}" title="Cetak kwitansi">
            <i class="ti ti-receipt"></i> Kwitansi</button></td>
    </tr>`).join('');
}


/* ------------------------------------------------------------------
   SETTLEMENT QRIS
   Angka diambil dari laporan settlement penyedia QRIS. Server menghitung
   biaya MDR (kotor - masuk Bank), menolak jumlah melebihi Saldo QRIS,
   menolak nomor referensi ganda, lalu membuat 2 jurnal otomatis.
   ------------------------------------------------------------------ */

let saldoQrisBelumCair = 0;

async function muatSettlement() {
  const [resRingkas, resDaftar] = await Promise.all([
    db.from('v_ringkasan_qris').select('*').single(),
    db.from('v_settlement_qris').select('*')
      .order('tanggal', { ascending: false }).order('id', { ascending: false }).limit(50)
  ]);
  if (adaError(resRingkas.error) || adaError(resDaftar.error)) return;

  const r = resRingkas.data;
  saldoQrisBelumCair = Number(r.saldo_belum_cair);
  $('st-ringkasan').innerHTML = `
    Saldo QRIS belum cair: <b>${rupiah(r.saldo_belum_cair)}</b>
    ${r.belum_cair_sejak ? `(penerimaan tertua sejak ${tanggalIndo(r.belum_cair_sejak)})` : ''}<br>
    Settlement terakhir: ${r.settlement_terakhir ? tanggalIndo(r.settlement_terakhir) : 'belum ada'}`;

  $('st-daftar').innerHTML = resDaftar.data.length === 0 ? barisKosong(6, 'Belum ada settlement') :
    resDaftar.data.map(s => `
      <tr data-id="${s.id}">
        <td>${tanggalIndo(s.tanggal)}</td>
        <td>${esc(s.no_referensi)}</td>
        <td class="angka">${rupiah(s.jumlah_bruto)}</td>
        <td class="angka">${rupiah(s.biaya_mdr)}</td>
        <td class="angka">${rupiah(s.jumlah_bersih)}</td>
        <td><small class="abu">${esc(s.nama_pembuat || 'data contoh')}</small></td>
      </tr>`).join('');
  tampilkanInfoSettlement();
}

// Pratinjau biaya MDR (kotor - masuk Bank) dan persentasenya, untuk diperiksa owner
function tampilkanInfoSettlement() {
  const bruto = Number($('st-bruto').value);
  const bersih = Number($('st-bersih').value);
  const el = $('st-info');
  if (!bruto || $('st-bersih').value === '') {
    el.className = 'pratinjau';
    el.textContent = `Salin angka dari laporan settlement penyedia QRIS. Saldo belum cair: ${rupiah(saldoQrisBelumCair)}.`;
    return;
  }
  const mdr = bruto - bersih;
  let masalah = '';
  if (bersih > bruto) masalah = 'Jumlah masuk Bank tidak boleh lebih besar dari jumlah kotor.';
  else if (bruto > saldoQrisBelumCair) masalah = `Jumlah kotor melebihi Saldo QRIS belum cair (${rupiah(saldoQrisBelumCair)}).`;
  el.className = 'pratinjau ' + (masalah ? 'error' : 'ok');
  el.innerHTML = masalah ||
    `Biaya MDR: <b>${rupiah(mdr)}</b> (${(mdr / bruto * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}% dari jumlah kotor)`;
}

async function simpanSettlement(e) {
  e.preventDefault();
  const selesai = mulaiMemuat(e);
  const { data, error } = await db.from('settlement_qris').insert({
    tanggal: $('st-tanggal').value,
    no_referensi: $('st-referensi').value,
    jumlah_bruto: Number($('st-bruto').value),
    jumlah_bersih: Number($('st-bersih').value),
    catatan: $('st-catatan').value || null
    // biaya_mdr dihitung server
  }).select().single();
  const gagal = adaError(error);
  selesai(gagal);
  if (gagal) return;

  tampilkanPesan(`Settlement ${data.no_referensi} tercatat: ${rupiah(data.jumlah_bersih)} masuk Bank, MDR ${rupiah(data.biaya_mdr)}.`);
  ['st-referensi', 'st-bruto', 'st-bersih', 'st-catatan'].forEach(id => { $(id).value = ''; });
  await muatSettlement();
  sorotBaris(`#st-daftar tr[data-id="${data.id}"]`);
}
