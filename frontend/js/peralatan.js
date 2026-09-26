/* ==================================================================
   PERALATAN
   - Kelola data raket & bola (tambah / edit / stok)
   - Sewa peralatan untuk sebuah booking
       Jurnal: Kas (D) / Pendapatan Sewa Peralatan (K), stok berkurang
   - Pengembalian: stok bertambah; jika rusak ada denda
       Jurnal: Kas (D) / Pendapatan Denda (K)
   ================================================================== */

let prDaftar = [];        // data peralatan
let swDaftar = [];        // data sewa
let swSedangDiproses = null;

function siapkanPeralatan() {
  $('form-sewa').addEventListener('submit', simpanSewa);
  $('sw-peralatan').addEventListener('change', tampilkanInfoSewa);
  $('sw-jumlah').addEventListener('input', tampilkanInfoSewa);

  $('form-peralatan').addEventListener('submit', simpanPeralatan);
  $('pr-batal-edit').addEventListener('click', resetFormPeralatan);

  // Tombol "Edit" di tabel stok
  $('pr-daftar').addEventListener('click', (e) => {
    const tombol = e.target.closest('button[data-edit]');
    if (tombol) isiFormEditPeralatan(Number(tombol.dataset.edit));
  });

  // Tombol "Kembalikan" di tabel sewa -> buka dialog
  $('sw-daftar').addEventListener('click', (e) => {
    const tombol = e.target.closest('button[data-kembali]');
    if (!tombol) return;
    swSedangDiproses = swDaftar.find(s => s.id === Number(tombol.dataset.kembali));
    const s = swSedangDiproses;
    $('kb-info').innerHTML = `${s.jumlah} × ${esc(s.nama_peralatan)} – ${esc(s.kode_booking)} (${esc(s.nama_pelanggan)})`;
    $('kb-rusak').value = 0;
    $('kb-rusak').max = s.jumlah;
    $('kb-denda').value = 0;
    $('dialog-kembali').returnValue = '';   // kosongkan hasil dialog sebelumnya
    $('dialog-kembali').showModal();
  });

  // Saat dialog ditutup: proses jika tombol "Proses" yang ditekan
  $('dialog-kembali').addEventListener('close', () => {
    if ($('dialog-kembali').returnValue === 'simpan') prosesPengembalian();
  });
}

async function muatPeralatan() {
  // Kotak berkilau selama data pertama kali dimuat (animasi.js)
  skeletonTabel('pr-daftar', 6);
  skeletonTabel('sw-daftar', 9);
  const [resAlat, resBooking] = await Promise.all([
    db.from('peralatan').select('*').order('jenis').order('nama'),
    // booking yang boleh menyewa: semua kecuali batal (100 terbaru)
    db.from('v_booking_lengkap').select('id, kode_booking, nama_pelanggan, tanggal, jam_mulai, status')
      .neq('status', 'batal').order('tanggal', { ascending: false }).limit(100)
  ]);
  if (adaError(resAlat.error) || adaError(resBooking.error)) return;
  prDaftar = resAlat.data;

  isiSelect($('sw-booking'), resBooking.data, b => b.id,
    b => `${b.kode_booking} • ${b.nama_pelanggan} • ${tanggalIndo(b.tanggal)} ${jam(b.jam_mulai)}`, '-- pilih booking --');
  isiSelect($('sw-peralatan'), prDaftar, p => p.id,
    p => `${p.nama} – ${rupiah(p.tarif_sewa)} (stok ${p.stok})`, '-- pilih peralatan --');

  $('pr-daftar').innerHTML = prDaftar.length === 0 ? barisKosong(6) : prDaftar.map(p => `
    <tr data-id="${p.id}">
      <td>${esc(p.nama)}</td>
      <td>${esc(p.jenis)}</td>
      <td class="angka">${rupiah(p.tarif_sewa)}</td>
      <td class="angka">${rupiah(p.denda_rusak)}</td>
      <td class="angka ${p.stok < 5 ? 'stok-rendah' : ''}">${p.stok}</td>
      <td><button class="tombol tombol-kecil" data-edit="${p.id}">Edit</button></td>
    </tr>`).join('');

  tampilkanInfoSewa();
  await muatDaftarSewa();
}

function tampilkanInfoSewa() {
  const p = prDaftar.find(x => String(x.id) === $('sw-peralatan').value);
  const jumlah = Number($('sw-jumlah').value) || 0;
  const el = $('sw-info');
  if (!p) { el.className = 'pratinjau'; el.textContent = '-'; return; }
  if (jumlah > p.stok) {
    el.className = 'pratinjau error';
    el.textContent = `Stok tidak cukup. Tersedia ${p.stok}.`;
    return;
  }
  el.className = 'pratinjau';
  el.innerHTML = `${jumlah} × ${rupiah(p.tarif_sewa)} = <b>${rupiah(jumlah * p.tarif_sewa)}</b><br>
    Sisa stok setelah disewa: ${p.stok - jumlah}`;
}

async function simpanSewa(e) {
  e.preventDefault();
  const selesai = mulaiMemuat(e);   // tombol berputar (animasi.js)
  const { data, error } = await db.from('sewa_peralatan').insert({
    booking_id: Number($('sw-booking').value),
    peralatan_id: Number($('sw-peralatan').value),
    jumlah: Number($('sw-jumlah').value),
    tanggal_sewa: hariIni()
    // tarif & subtotal diisi trigger, stok dikurangi trigger
  }).select().single();
  const gagal = adaError(error);
  selesai(gagal);                   // jika gagal (misal stok kurang), form bergetar
  if (gagal) return;

  tampilkanPesan('Sewa peralatan tercatat, stok berkurang.');
  $('sw-jumlah').value = 1;
  await muatPeralatan();
  sorotBaris(`#sw-daftar tr[data-id="${data.id}"]`);
}

async function muatDaftarSewa() {
  const { data, error } = await db.from('v_sewa_lengkap').select('*')
    .order('tanggal_sewa', { ascending: false }).order('id', { ascending: false }).limit(100);
  if (adaError(error)) return;
  swDaftar = data;

  $('sw-daftar').innerHTML = data.length === 0 ? barisKosong(9) : data.map(s => `
    <tr data-id="${s.id}">
      <td>${tanggalIndo(s.tanggal_sewa)}</td>
      <td>${esc(s.kode_booking)}</td>
      <td>${esc(s.nama_pelanggan)}</td>
      <td>${esc(s.nama_peralatan)}</td>
      <td class="angka">${s.jumlah}${s.jumlah_rusak ? ` <small>(${s.jumlah_rusak} rusak)</small>` : ''}</td>
      <td class="angka">${rupiah(s.subtotal)}</td>
      <td>${badge(s.status_kembali)}</td>
      <td class="angka">${s.denda > 0 ? rupiah(s.denda) : '-'}</td>
      <td>${s.status_kembali === 'dipinjam'
        ? `<button class="tombol tombol-kecil tombol-utama" data-kembali="${s.id}">Kembalikan</button>` : '-'}</td>
    </tr>`).join('');
}

async function prosesPengembalian() {
  const s = swSedangDiproses;
  const rusak = Number($('kb-rusak').value) || 0;
  if (rusak < 0 || rusak > s.jumlah) {
    return tampilkanPesan(`Jumlah rusak harus 0 s.d. ${s.jumlah}.`, 'error');
  }

  const { data, error } = await db.from('sewa_peralatan').update({
    status_kembali: rusak > 0 ? 'rusak' : 'dikembalikan',
    jumlah_rusak: rusak,
    denda: Number($('kb-denda').value) || 0,   // 0 = dihitung otomatis oleh trigger
    tanggal_kembali: hariIni()
  }).eq('id', s.id).select().single();
  if (adaError(error)) return;

  tampilkanPesan(data.denda > 0
    ? `Dikembalikan dengan ${rusak} unit rusak. Denda ${rupiah(data.denda)} dicatat.`
    : 'Peralatan dikembalikan, stok bertambah.');
  await muatPeralatan();
  sorotBaris(`#sw-daftar tr[data-id="${s.id}"]`);
  sorotBaris(`#pr-daftar tr[data-id="${s.peralatan_id}"]`);   // stoknya berubah
}

// ---- Tambah / edit data peralatan ----
function isiFormEditPeralatan(id) {
  const p = prDaftar.find(x => x.id === id);
  $('pr-id').value = p.id;
  $('pr-nama').value = p.nama;
  $('pr-jenis').value = p.jenis;
  $('pr-stok').value = p.stok;
  $('pr-tarif').value = p.tarif_sewa;
  $('pr-denda').value = p.denda_rusak;
  $('pr-judul-form').textContent = 'Edit Peralatan';
  $('pr-batal-edit').hidden = false;
  $('form-peralatan').scrollIntoView({ behavior: 'smooth' });
}

function resetFormPeralatan() {
  $('form-peralatan').reset();
  $('pr-id').value = '';
  $('pr-judul-form').textContent = 'Tambah Peralatan';
  $('pr-batal-edit').hidden = true;
}

async function simpanPeralatan(e) {
  e.preventDefault();
  const isian = {
    nama: $('pr-nama').value.trim(),
    jenis: $('pr-jenis').value,
    stok: Number($('pr-stok').value),
    tarif_sewa: Number($('pr-tarif').value),
    denda_rusak: Number($('pr-denda').value)
  };
  const id = $('pr-id').value;

  const selesai = mulaiMemuat(e);
  // Jika ada id -> update, jika tidak -> insert. .select().single() -> ambil id-nya
  const { data, error } = id
    ? await db.from('peralatan').update(isian).eq('id', Number(id)).select().single()
    : await db.from('peralatan').insert(isian).select().single();
  const gagal = adaError(error);
  selesai(gagal);
  if (gagal) return;

  tampilkanPesan(id ? 'Data peralatan diperbarui.' : 'Peralatan baru ditambahkan.');
  resetFormPeralatan();
  await muatPeralatan();
  sorotBaris(`#pr-daftar tr[data-id="${data.id}"]`);
}
