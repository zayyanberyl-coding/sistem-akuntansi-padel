/* ==================================================================
   MEMBER
   - Data pelanggan
   - Jenis paket member (jumlah jam, harga, masa berlaku)
   - Penjualan paket member
       Jurnal: Kas (D) / Pendapatan Diterima di Muka (K)
       Pendapatan diakui per jam saat booking member selesai dimainkan.
   ================================================================== */

let pkDaftar = [];

// Dipakai tombol "Member baru" di halaman Booking:
//   daftarDariBooking         -> true jika datang dari halaman Booking
//   pelangganBaruUntukBooking -> id pelanggan baru yang akan dipilih di form Booking
let daftarDariBooking = false;
let pelangganBaruUntukBooking = null;

function siapkanMember() {
  $('bp-tanggal').value = hariIni();
  $('form-pelanggan').addEventListener('submit', simpanPelanggan);
  $('form-paket').addEventListener('submit', simpanPaket);
  $('form-beli-paket').addEventListener('submit', simpanPembelianPaket);

  // ---- Modal "Paket baru" ----
  $('pk-buka-modal').addEventListener('click', () => {
    $('form-paket').reset();
    tampilkanHargaPerJam();
    $('dialog-paket').showModal();   // tampilkan modal + gelapkan latar
    $('pk-nama').focus();
  });
  $('pk-tutup-modal').addEventListener('click', () => $('dialog-paket').close());
  $('pk-batal').addEventListener('click', () => $('dialog-paket').close());
  // Klik area gelap di luar kotak modal juga menutup modal
  $('dialog-paket').addEventListener('click', (e) => {
    if (e.target === $('dialog-paket')) $('dialog-paket').close();
  });
  $('pk-jam').addEventListener('input', tampilkanHargaPerJam);
  $('pk-harga').addEventListener('input', tampilkanHargaPerJam);

  // Tombol aktif/nonaktifkan paket
  $('pk-daftar').addEventListener('click', async (e) => {
    const tombol = e.target.closest('button[data-paket]');
    if (!tombol) return;
    const p = pkDaftar.find(x => x.id === Number(tombol.dataset.paket));
    const { error } = await db.from('paket_member').update({ aktif: !p.aktif }).eq('id', p.id);
    if (adaError(error)) return;
    tampilkanPesan(`${p.nama_paket} ${p.aktif ? 'tidak dijual lagi' : 'dijual kembali'}.`);
    muatMember();
  });
}

async function muatMember() {
  // Kotak berkilau selama data pertama kali dimuat (animasi.js)
  skeletonTabel('bp-daftar', 8);
  skeletonTabel('pl-daftar', 4);
  skeletonTabel('pk-daftar', 6, 2);
  const [resPelanggan, resPaket, resBeli] = await Promise.all([
    db.from('pelanggan').select('*').order('nama'),
    db.from('paket_member').select('*').order('harga'),
    db.from('v_pembelian_paket_lengkap').select('*').order('tanggal_beli', { ascending: false }).limit(100)
  ]);
  if (adaError(resPelanggan.error) || adaError(resPaket.error) || adaError(resBeli.error)) return;
  pkDaftar = resPaket.data;

  // ---- Pelanggan ----
  const pelanggan = resPelanggan.data;
  $('pl-daftar').innerHTML = pelanggan.length === 0 ? barisKosong(4) : pelanggan.map(p => `
    <tr data-id="${p.id}">
      <td>${esc(p.nama)}</td>
      <td>${esc(p.no_hp || '-')}</td>
      <td>${esc(p.email || '-')}</td>
      <td>${tanggalIndo(p.tanggal_daftar)}</td>
    </tr>`).join('');
  isiSelect($('bp-pelanggan'), pelanggan, p => p.id, p => p.nama, '-- pilih pelanggan --');

  // ---- Jenis paket ----
  $('pk-daftar').innerHTML = pkDaftar.length === 0 ? barisKosong(6) : pkDaftar.map(p => `
    <tr data-id="${p.id}">
      <td>${esc(p.nama_paket)} ${p.aktif ? '' : '<span class="badge badge-batal">nonaktif</span>'}</td>
      <td class="angka">${p.jumlah_jam}</td>
      <td class="angka">${rupiah(p.harga)}</td>
      <td class="angka">${rupiah(p.harga / p.jumlah_jam)}</td>
      <td>${p.masa_berlaku_hari} hari</td>
      <td><button class="tombol tombol-kecil" data-paket="${p.id}">${p.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button></td>
    </tr>`).join('');
  isiSelect($('bp-paket'), pkDaftar.filter(p => p.aktif), p => p.id,
    p => `${p.nama_paket} – ${rupiah(p.harga)} (${p.jumlah_jam} jam, ${p.masa_berlaku_hari} hari)`, '-- pilih paket --');

  // ---- Paket terjual ----
  const beli = resBeli.data;
  $('bp-daftar').innerHTML = beli.length === 0 ? barisKosong(8) : beli.map(b => {
    let status = '<span class="badge badge-selesai">aktif</span>';
    if (b.kadaluarsa) status = '<span class="badge badge-batal">kadaluarsa</span>';
    else if (b.sisa_jam === 0) status = '<span class="badge badge-lunas">habis</span>';
    return `
      <tr data-id="${b.id}">
        <td>${tanggalIndo(b.tanggal_beli)}</td>
        <td>${esc(b.nama_pelanggan)}</td>
        <td>${esc(b.nama_paket)}</td>
        <td class="angka">${rupiah(b.harga)}</td>
        <td class="angka">${b.jam_terpakai} / ${b.jam_total}</td>
        <td class="angka">${b.sisa_jam}</td>
        <td>${tanggalIndo(b.tanggal_kadaluarsa)}</td>
        <td>${status}</td>
      </tr>`;
  }).join('');

  // Datang dari tombol "Member baru" di Booking -> langsung siap mengetik nama
  if (daftarDariBooking) {
    $('form-pelanggan').scrollIntoView({ behavior: 'smooth' });
    $('pl-nama').focus();
  }
}

async function simpanPelanggan(e) {
  e.preventDefault();
  const selesai = mulaiMemuat(e);   // tombol berputar (animasi.js)
  // .select().single() -> minta data yang baru disimpan (butuh id-nya)
  const { data, error } = await db.from('pelanggan').insert({
    nama: $('pl-nama').value.trim(),
    no_hp: $('pl-hp').value.trim() || null,
    email: $('pl-email').value.trim() || null
  }).select().single();
  const gagal = adaError(error);
  selesai(gagal);
  if (gagal) return;
  $('form-pelanggan').reset();

  if (daftarDariBooking) {
    // Kembali ke Booking dengan pelanggan baru sudah terpilih
    pelangganBaruUntukBooking = data.id;
    tampilkanPesan(`${data.nama} terdaftar. Silakan lanjutkan booking.`);
    location.hash = '#booking';
    return;
  }
  tampilkanPesan('Pelanggan baru ditambahkan.');
  await muatMember();
  sorotBaris(`#pl-daftar tr[data-id="${data.id}"]`);
}

async function simpanPaket(e) {
  e.preventDefault();
  const selesai = mulaiMemuat(e);
  const { data, error } = await db.from('paket_member').insert({
    nama_paket: $('pk-nama').value.trim(),
    jumlah_jam: Number($('pk-jam').value),
    harga: Number($('pk-harga').value),
    masa_berlaku_hari: Number($('pk-hari').value)
  }).select().single();
  const gagal = adaError(error);
  selesai(gagal);                   // jika gagal (misal nama paket sudah ada), modal bergetar
  if (gagal) return;

  $('dialog-paket').close();
  tampilkanPesan(`${data.nama_paket} ditambahkan.`);
  await muatMember();
  $('bp-paket').value = data.id;   // langsung pilih paket baru di form Paket Membership
  sorotBaris(`#pk-daftar tr[data-id="${data.id}"]`);
}

// Info kecil di modal: harga per jam = harga / jumlah jam
function tampilkanHargaPerJam() {
  const jamPaket = Number($('pk-jam').value);
  const harga = Number($('pk-harga').value);
  $('pk-info').innerHTML = jamPaket > 0 && harga > 0
    ? `Harga per jam: <b>${rupiah(harga / jamPaket)}</b>. Nilai inilah yang diakui sebagai pendapatan setiap 1 jam dipakai.`
    : 'Isi jumlah jam dan harga untuk melihat harga per jam.';
}

async function simpanPembelianPaket(e) {
  e.preventDefault();
  const paket = pkDaftar.find(p => String(p.id) === $('bp-paket').value);
  const selesai = mulaiMemuat(e);
  const { data, error } = await db.from('pembelian_paket').insert({
    pelanggan_id: Number($('bp-pelanggan').value),
    paket_id: Number($('bp-paket').value),
    tanggal_beli: $('bp-tanggal').value,
    metode_bayar: $('bp-metode').value
    // harga, jam_total, tanggal_kadaluarsa diisi otomatis oleh trigger
  }).select().single();
  const gagal = adaError(error);
  selesai(gagal);
  if (gagal) return;

  tampilkanPesan(`${paket.nama_paket} terjual. Kas ${rupiah(paket.harga)} dicatat sebagai Pendapatan Diterima di Muka.`);
  await muatMember();
  sorotBaris(`#bp-daftar tr[data-id="${data.id}"]`);
}
