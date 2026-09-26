/* ==================================================================
   BOOKING
   - Form booking baru + pratinjau tarif (normal / prime time)
   - Cek bentrok jadwal sebelum disimpan
   - Jadwal lapangan per tanggal (grid)
   - Daftar booking + aksi Bayar / Selesai / Batal
   Catatan: harga & bentrok juga dicek ulang oleh trigger di database,
   jadi walaupun frontend dilewati, data tetap aman.
   ================================================================== */

let bkLapangan = [];          // daftar lapangan aktif
let bkDaftar = [];            // daftar booking yang sedang ditampilkan
let bkNomorPratinjau = 0;     // penanda agar hasil pratinjau lama diabaikan
let bkAdaBentrok = false;

const JAM_BUKA = 7;
const JAM_TUTUP = 23;

// Dipanggil SEKALI: memasang event listener
function siapkanBooking() {
  // Isi pilihan jam 07:00 s.d. 23:00
  const opsiJam = (dari, sampai) => {
    let html = '';
    for (let j = dari; j <= sampai; j++) html += `<option value="${jamKeTeks(j)}">${jamKeTeks(j)}</option>`;
    return html;
  };
  $('bk-jam-mulai').innerHTML = opsiJam(JAM_BUKA, JAM_TUTUP - 1);
  $('bk-jam-selesai').innerHTML = opsiJam(JAM_BUKA + 1, JAM_TUTUP);

  // Tombol "Member baru": pindah ke menu Member untuk mendaftar,
  // lalu setelah disimpan otomatis kembali ke sini (lihat member.js)
  $('bk-member-baru').addEventListener('click', () => {
    daftarDariBooking = true;
    location.hash = '#member';
  });
  $('bk-tanggal').value = hariIni();

  // Jam selesai otomatis 1 jam setelah jam mulai jika tidak masuk akal
  $('bk-jam-mulai').addEventListener('change', () => {
    if ($('bk-jam-selesai').value <= $('bk-jam-mulai').value) {
      const mulai = parseInt($('bk-jam-mulai').value);
      $('bk-jam-selesai').value = jamKeTeks(mulai + 1);
    }
    perbaruiPratinjau();
  });

  ['bk-lapangan', 'bk-jam-selesai', 'bk-paket'].forEach(id =>
    $(id).addEventListener('change', perbaruiPratinjau));

  $('bk-tanggal').addEventListener('change', () => {
    muatJadwal();
    perbaruiPratinjau();
  });

  // Paket member hanya muncul jika cara bayar = member
  $('bk-metode').addEventListener('change', async () => {
    $('bk-wrap-paket').hidden = $('bk-metode').value !== 'member';
    await muatPaketPelanggan();
    perbaruiPratinjau();
  });
  $('bk-pelanggan').addEventListener('change', async () => {
    await muatPaketPelanggan();
    perbaruiPratinjau();
  });

  $('form-booking').addEventListener('submit', simpanBooking);

  // Klik slot kosong di jadwal -> isi form otomatis
  $('bk-jadwal').addEventListener('click', (e) => {
    const sel = e.target.closest('td.slot-kosong');
    if (!sel) return;
    $('bk-lapangan').value = sel.dataset.lapangan;
    $('bk-jam-mulai').value = sel.dataset.jam;
    $('bk-jam-selesai').value = jamKeTeks(parseInt(sel.dataset.jam) + 1);
    perbaruiPratinjau();
    $('form-booking').scrollIntoView({ behavior: 'smooth' });
  });

  // Filter daftar booking
  $('bk-filter-tanggal').addEventListener('change', muatDaftarBooking);
  $('bk-filter-status').addEventListener('change', muatDaftarBooking);
  $('bk-filter-reset').addEventListener('click', () => {
    $('bk-filter-tanggal').value = '';
    $('bk-filter-status').value = '';
    muatDaftarBooking();
  });

  // Tombol aksi di tabel (satu listener untuk semua tombol)
  $('bk-daftar').addEventListener('click', (e) => {
    const tombol = e.target.closest('button[data-aksi]');
    if (!tombol) return;
    const id = Number(tombol.dataset.id);
    if (tombol.dataset.aksi === 'bayar') {
      pembayaranBookingTerpilih = id;  // variabel di pembayaran.js
      location.hash = '#pembayaran';
    } else {
      ubahStatusBooking(id, tombol.dataset.aksi);
    }
  });
}

// Dipanggil SETIAP halaman Booking dibuka
async function muatBooking() {
  const [resPelanggan, resLapangan] = await Promise.all([
    db.from('pelanggan').select('id, nama, no_hp').order('nama'),
    db.from('lapangan').select('*').eq('aktif', true).order('nama')
  ]);
  if (adaError(resPelanggan.error) || adaError(resLapangan.error)) return;

  bkLapangan = resLapangan.data;
  isiSelect($('bk-pelanggan'), resPelanggan.data, p => p.id, p => p.nama + (p.no_hp ? ` (${p.no_hp})` : ''), '-- pilih pelanggan --');

  // Baru kembali dari mendaftarkan member? Langsung pilih pelanggan barunya
  daftarDariBooking = false;
  if (pelangganBaruUntukBooking) {
    $('bk-pelanggan').value = pelangganBaruUntukBooking;
    pelangganBaruUntukBooking = null;
  }
  isiSelect($('bk-lapangan'), bkLapangan, l => l.id,
    l => `${l.nama} (${l.jenis}) – ${rupiah(l.tarif_normal)} / ${rupiah(l.tarif_prime)}`, '-- pilih lapangan --');

  await muatPaketPelanggan();
  await Promise.all([muatJadwal(), muatDaftarBooking()]);
  perbaruiPratinjau();
}

// Paket member milik pelanggan terpilih yang masih punya sisa jam & belum kadaluarsa
async function muatPaketPelanggan() {
  const el = $('bk-paket');
  const pelangganId = $('bk-pelanggan').value;
  if ($('bk-metode').value !== 'member' || !pelangganId) {
    el.innerHTML = '';
    return;
  }
  const { data, error } = await db.from('v_pembelian_paket_lengkap').select('*')
    .eq('pelanggan_id', pelangganId).gt('sisa_jam', 0).gte('tanggal_kadaluarsa', hariIni())
    .order('tanggal_kadaluarsa');
  if (adaError(error)) return;

  isiSelect(el, data, p => p.id,
    p => `${p.nama_paket} – sisa ${p.sisa_jam} jam (s.d. ${tanggalIndo(p.tanggal_kadaluarsa)})`,
    data.length ? null : 'Pelanggan ini tidak punya paket aktif');

  // simpan info paket di atribut option untuk pratinjau
  [...el.options].forEach(opt => {
    const p = data.find(x => String(x.id) === opt.value);
    if (p) {
      opt.dataset.hargaPerJam = p.harga / p.jam_total;
      opt.dataset.sisa = p.sisa_jam;
    }
  });
}

// Pratinjau tarif + cek bentrok setiap kali isian form berubah
async function perbaruiPratinjau() {
  const el = $('bk-pratinjau');
  const lapanganId = $('bk-lapangan').value;
  const tanggal = $('bk-tanggal').value;
  const mulai = $('bk-jam-mulai').value;
  const selesai = $('bk-jam-selesai').value;
  const nomor = ++bkNomorPratinjau;

  bkAdaBentrok = false;
  el.className = 'pratinjau';
  if (!lapanganId || !tanggal) {
    el.textContent = 'Pilih lapangan, tanggal & jam untuk melihat tarif.';
    return;
  }
  if (selesai <= mulai) {
    el.className = 'pratinjau error';
    el.textContent = 'Jam selesai harus lebih besar dari jam mulai.';
    return;
  }

  // 1) Cek bentrok: booking lain (bukan batal) di lapangan & tanggal yang sama
  //    yang jamnya saling tumpang tindih.
  const cekBentrok = db.from('booking').select('kode_booking, jam_mulai, jam_selesai')
    .eq('lapangan_id', lapanganId).eq('tanggal', tanggal).neq('status', 'batal')
    .lt('jam_mulai', selesai).gt('jam_selesai', mulai);

  // 2) Hitung tarif lewat fungsi SQL hitung_tarif (RPC)
  const cekTarif = db.rpc('hitung_tarif', {
    p_lapangan_id: Number(lapanganId), p_tanggal: tanggal,
    p_jam_mulai: mulai, p_jam_selesai: selesai
  });

  const [resBentrok, resTarif] = await Promise.all([cekBentrok, cekTarif]);
  if (nomor !== bkNomorPratinjau) return;   // sudah ada pratinjau yang lebih baru

  if (resBentrok.error || resTarif.error) {
    el.className = 'pratinjau error';
    el.textContent = (resBentrok.error || resTarif.error).message;
    return;
  }

  if (resBentrok.data.length > 0) {
    const b = resBentrok.data[0];
    bkAdaBentrok = true;
    el.className = 'pratinjau error';
    el.innerHTML = `<i class="ti ti-alert-triangle"></i> <b>Jadwal bentrok</b> dengan ${esc(b.kode_booking)} (${jam(b.jam_mulai)}–${jam(b.jam_selesai)}). Pilih jam lain.`;
    return;
  }

  const t = resTarif.data[0];
  const lap = bkLapangan.find(l => String(l.id) === lapanganId);
  let html = `<i class="ti ti-circle-check"></i> <b>Jadwal tersedia</b><br>
    Durasi: <b>${t.durasi_jam} jam</b> (${t.jam_normal} jam normal × ${rupiah(lap.tarif_normal)},
    ${t.jam_prime} jam prime × ${rupiah(lap.tarif_prime)})<br>
    Jenis tarif: <b>${esc(t.jenis_tarif)}</b><br>`;

  if ($('bk-metode').value === 'member') {
    const opt = $('bk-paket').selectedOptions[0];
    if (!opt || !opt.dataset.hargaPerJam) {
      el.className = 'pratinjau error';
      el.textContent = 'Pilih paket member yang masih aktif.';
      return;
    }
    if (Number(opt.dataset.sisa) < t.durasi_jam) {
      el.className = 'pratinjau error';
      el.textContent = `Sisa jam paket (${opt.dataset.sisa} jam) tidak cukup.`;
      return;
    }
    html += `Dibayar dengan paket member (memotong ${t.durasi_jam} jam).<br>
      Nilai pendapatan yang diakui saat selesai: <b>${rupiah(opt.dataset.hargaPerJam * t.durasi_jam)}</b>`;
  } else {
    html += `Total: <b>${rupiah(t.total)}</b> &nbsp;·&nbsp; Saran DP 50%: ${rupiah(t.total / 2)}`;
  }
  el.className = 'pratinjau ok';
  el.innerHTML = html;
}

async function simpanBooking(e) {
  e.preventDefault();   // cegah form me-reload halaman
  if (bkAdaBentrok) {
    tampilkanPesan('Jadwal bentrok, pilih jam lain.', 'error');
    getarkan(e.target);   // form bergetar (animasi.js)
    return;
  }
  const pakaiMember = $('bk-metode').value === 'member';
  if (pakaiMember && !$('bk-paket').value) {
    tampilkanPesan('Pilih paket member terlebih dahulu.', 'error');
    getarkan(e.target);
    return;
  }

  const dataBaru = {
    pelanggan_id: Number($('bk-pelanggan').value),
    lapangan_id: Number($('bk-lapangan').value),
    tanggal: $('bk-tanggal').value,
    jam_mulai: $('bk-jam-mulai').value,
    jam_selesai: $('bk-jam-selesai').value,
    pembelian_paket_id: pakaiMember ? Number($('bk-paket').value) : null,
    catatan: $('bk-catatan').value.trim() || null
  };

  const selesai = mulaiMemuat(e);   // tombol Simpan berputar (animasi.js)
  // .select().single() -> minta data hasil insert (sudah diisi trigger)
  const { data, error } = await db.from('booking').insert(dataBaru).select().single();
  const gagal = adaError(error);
  selesai(gagal);                   // hentikan putaran; jika gagal, form bergetar
  if (gagal) return;

  tampilkanPesan(`Booking ${data.kode_booking} tersimpan. ` +
    (pakaiMember ? 'Dibayar dengan paket member.' : `Total ${rupiah(data.total_harga)}, silakan terima DP.`));
  $('bk-catatan').value = '';
  await muatPaketPelanggan();
  await Promise.all([muatJadwal(), muatDaftarBooking()]);
  perbaruiPratinjau();

  // Slot baru di jadwal "pop" & barisnya di daftar berkedip hijau
  sorotBaris(`#bk-jadwal td[data-id="${data.id}"]`);
  sorotBaris(`#bk-daftar tr[data-id="${data.id}"]`);
}

// Grid jadwal: baris = jam, kolom = lapangan
async function muatJadwal() {
  const tanggal = $('bk-tanggal').value;
  $('bk-label-jadwal').textContent = tanggal ? '– ' + tanggalPanjang(tanggal) : '';
  if (!tanggal) return;

  const { data, error } = await db.from('v_booking_lengkap')
    .select('id, lapangan_id, jam_mulai, jam_selesai, durasi_jam, nama_pelanggan, kode_booking, status, pembelian_paket_id')
    .eq('tanggal', tanggal).neq('status', 'batal');
  if (adaError(error)) return;

  // Okupansi = jam terisi / total jam tersedia semua lapangan
  const jamTersedia = bkLapangan.length * (JAM_TUTUP - JAM_BUKA);
  const jamTerisi = data.reduce((total, b) => total + b.durasi_jam, 0);
  $('bk-okupansi').textContent = jamTersedia
    ? `Okupansi ${Math.round((jamTerisi / jamTersedia) * 100)}%` : '';

  let html = '<thead><tr><th></th>' +
    bkLapangan.map(l => `<th>${esc(l.nama)}</th>`).join('') + '</tr></thead><tbody>';

  for (let j = JAM_BUKA; j < JAM_TUTUP; j++) {
    const teksJam = jamKeTeks(j);
    html += `<tr><th>${teksJam}</th>`;
    for (const lap of bkLapangan) {
      // cari booking di lapangan ini yang mencakup jam ini
      const b = data.find(x => x.lapangan_id === lap.id &&
        jam(x.jam_mulai) <= teksJam && teksJam < jam(x.jam_selesai));

      if (!b) {
        html += `<td class="slot-kosong" data-lapangan="${lap.id}" data-jam="${teksJam}"></td>`;
      } else if (jam(b.jam_mulai) === teksJam) {
        // Jam pertama booking: buat satu blok setinggi durasinya (rowspan)
        const kelas = b.pembelian_paket_id && b.status !== 'selesai' ? 'slot-member' : 'slot-' + b.status;
        html += `<td class="${kelas}" rowspan="${b.durasi_jam}" data-id="${b.id}" title="${esc(b.kode_booking)} – ${esc(b.status)}">
                   ${esc(b.nama_pelanggan.split(' ')[0])}<br><small>${jam(b.jam_mulai)}–${jam(b.jam_selesai)}</small>
                 </td>`;
      }
      // jam berikutnya dari booking yang sama tidak perlu sel lagi (sudah ditutup rowspan)
    }
    html += '</tr>';
  }
  $('bk-jadwal').innerHTML = html + '</tbody>';
}

async function muatDaftarBooking() {
  let query = db.from('v_booking_lengkap').select('*')
    .order('tanggal', { ascending: false }).order('jam_mulai', { ascending: false }).limit(200);

  // filter hanya dipakai jika diisi
  if ($('bk-filter-tanggal').value) query = query.eq('tanggal', $('bk-filter-tanggal').value);
  if ($('bk-filter-status').value) query = query.eq('status', $('bk-filter-status').value);

  skeletonTabel('bk-daftar', 10);   // kotak berkilau saat pertama kali dimuat
  const { data, error } = await query;
  if (adaError(error)) return;
  bkDaftar = data;

  $('bk-daftar').innerHTML = data.length === 0 ? barisKosong(10) : data.map(b => {
    let aksi = '-';
    if (b.status === 'menunggu' || b.status === 'dp') {
      aksi = `<button class="tombol tombol-kecil" data-aksi="bayar" data-id="${b.id}">Bayar</button>
              <button class="tombol tombol-kecil tombol-bahaya" data-aksi="batal" data-id="${b.id}">Batal</button>`;
    } else if (b.status === 'lunas') {
      aksi = `<button class="tombol tombol-kecil tombol-utama" data-aksi="selesai" data-id="${b.id}">Selesai</button>
              <button class="tombol tombol-kecil tombol-bahaya" data-aksi="batal" data-id="${b.id}">Batal</button>`;
    }
    return `
      <tr data-id="${b.id}">
        <td>${esc(b.kode_booking)}</td>
        <td>${tanggalIndo(b.tanggal)}</td>
        <td>${jam(b.jam_mulai)}–${jam(b.jam_selesai)}</td>
        <td>${esc(b.nama_lapangan)}</td>
        <td>${esc(b.nama_pelanggan)}</td>
        <td>${esc(b.jenis_tarif)}</td>
        <td class="angka">${rupiah(b.total_harga)}</td>
        <td class="angka">${rupiah(b.sisa_tagihan)}</td>
        <td>${badge(b.status)}</td>
        <td>${aksi}</td>
      </tr>`;
  }).join('');
}

// Ubah status: 'selesai' (pendapatan diakui) atau 'batal' (DP hangus)
async function ubahStatusBooking(id, statusBaru) {
  const b = bkDaftar.find(x => x.id === id);
  let pesan;
  if (statusBaru === 'selesai') {
    pesan = `Tandai ${b.kode_booking} SELESAI dimainkan?\n\n` +
      `Jurnal otomatis: Pendapatan Diterima di Muka (D) / Pendapatan Sewa Lapangan (K) ${rupiah(b.total_harga)}`;
  } else if (b.pembelian_paket_id) {
    pesan = `Batalkan ${b.kode_booking}?\n\n${b.durasi_jam} jam akan dikembalikan ke paket member pelanggan.`;
  } else {
    pesan = `Batalkan ${b.kode_booking}?\n\n` + (b.total_dibayar > 0
      ? `Uang yang sudah dibayar (${rupiah(b.total_dibayar)}) HANGUS dan dicatat sebagai Pendapatan Lain-lain.`
      : 'Belum ada pembayaran, tidak ada jurnal yang dibuat.');
  }
  if (!confirm(pesan)) return;

  const { error } = await db.from('booking').update({ status: statusBaru }).eq('id', id);
  if (adaError(error)) return;

  tampilkanPesan(`Booking ${b.kode_booking} ${statusBaru === 'selesai' ? 'selesai, pendapatan diakui' : 'dibatalkan'}.`);
  await Promise.all([muatJadwal(), muatDaftarBooking(), muatPaketPelanggan()]);
  sorotBaris(`#bk-daftar tr[data-id="${id}"]`);   // baris yang diubah berkedip hijau
}
