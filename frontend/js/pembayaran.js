/* ==================================================================
   PEMBAYARAN
   Menerima DP / pelunasan untuk booking reguler.
   Jurnal otomatis (trigger): Kas (D) / Pendapatan Diterima di Muka (K)
   Status booking otomatis berubah jadi 'dp' atau 'lunas'.
   ================================================================== */

let byDaftarBooking = [];                 // booking yang belum lunas
let pembayaranBookingTerpilih = null;     // diisi dari tombol "Bayar" di halaman Booking

function siapkanPembayaran() {
  $('by-tanggal').value = hariIni();
  $('by-booking').addEventListener('change', tampilkanInfoTagihan);

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
  await muatRiwayatPembayaran();
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
  skeletonTabel('by-daftar', 6);
  const { data, error } = await db.from('v_pembayaran_lengkap').select('*')
    .order('tanggal', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (adaError(error)) return;

  $('by-daftar').innerHTML = data.length === 0 ? barisKosong(6) : data.map(p => `
    <tr data-id="${p.id}">
      <td>${tanggalIndo(p.tanggal)}</td>
      <td>${esc(p.kode_booking)}</td>
      <td>${esc(p.nama_pelanggan)}</td>
      <td>${badge(p.jenis)}</td>
      <td>${esc(p.metode_bayar)}</td>
      <td class="angka">${rupiah(p.jumlah)}</td>
    </tr>`).join('');
}
