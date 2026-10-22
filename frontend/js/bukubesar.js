/* ==================================================================
   BUKU BESAR
   Rincian mutasi per akun + saldo berjalan.
   Saldo awal = saldo semua transaksi SEBELUM tanggal "Dari".
   Arah saldo mengikuti saldo normal akun:
     - Saldo normal D (Kas)                         : + debit, - kredit
     - Saldo normal K (Kewajiban & Pendapatan)       : + kredit, - debit
   ================================================================== */

let bbAkun = [];

function siapkanBukuBesar() {
  $('bb-dari').value = tambahHari(hariIni(), -30);
  $('bb-sampai').value = hariIni();
  $('bb-tampil').addEventListener('click', muatBukuBesar);
}

async function muatBukuBesar() {
  // Isi pilihan akun (sekali saja)
  if (bbAkun.length === 0) {
    const { data, error } = await db.from('akun').select('*').order('kode');
    if (adaError(error)) return;
    bbAkun = data;
    isiSelect($('bb-akun'), bbAkun, a => a.kode, a => `${a.kode} – ${a.nama}`, '— Semua akun —');
  }

  const dari = $('bb-dari').value;
  const sampai = $('bb-sampai').value;
  const kodeDipilih = $('bb-akun').value;

  skeletonBlok('bb-isi', 260);     // kotak berkilau saat pertama kali dimuat (animasi.js)
  // ambilSemua: bisa lebih dari 1.000 baris (lihat app.js)
  const filterAkun = (query) => kodeDipilih ? query.eq('akun_kode', kodeDipilih) : query;
  const [resAwal, resPeriode] = await Promise.all([
    // Saldo awal: ringkasan per hari SEBELUM tanggal "dari" (dijumlah di server)
    ambilSemua(() => filterAkun(db.from('v_mutasi_harian').select('tanggal, akun_kode, debit, kredit')
      .lt('tanggal', dari).order('tanggal').order('akun_kode').order('sumber'))),
    // Rincian transaksi hanya dalam periode yang dipilih
    ambilSemua(() => filterAkun(db.from('v_jurnal_lengkap').select('*')
      .gte('tanggal', dari).lte('tanggal', sampai).order('tanggal').order('jurnal_id').order('id')))
  ]);
  if (adaError(resAwal.error) || adaError(resPeriode.error)) return;

  const akunDitampilkan = kodeDipilih ? bbAkun.filter(a => a.kode === kodeDipilih) : bbAkun;
  $('bb-isi').innerHTML = akunDitampilkan
    .map(akun => tabelBukuBesar(akun,
      resAwal.data.filter(d => d.akun_kode === akun.kode),
      resPeriode.data.filter(d => d.akun_kode === akun.kode), dari))
    .join('');
}

// Membuat tabel buku besar untuk satu akun
//   sebelum : mutasi sebelum periode (untuk saldo awal)
//   periode : baris jurnal di dalam periode
function tabelBukuBesar(akun, sebelum, periode, dari) {
  let saldo = hitungSaldo(sebelum, akun.saldo_normal);
  let totalDebit = 0;
  let totalKredit = 0;

  let isi = `
    <tr>
      <td>${tanggalIndo(dari)}</td><td></td><td><i>Saldo awal</i></td>
      <td></td><td></td><td class="angka">${rupiah(saldo)}</td>
    </tr>`;

  for (const b of periode) {
    saldo += hitungSaldo([b], akun.saldo_normal);
    totalDebit += Number(b.debit);
    totalKredit += Number(b.kredit);
    isi += `
      <tr>
        <td>${tanggalIndo(b.tanggal)}</td>
        <td>${esc(b.no_bukti)}</td>
        <td>${esc(b.keterangan)}</td>
        <td class="angka">${b.debit > 0 ? rupiah(b.debit) : ''}</td>
        <td class="angka">${b.kredit > 0 ? rupiah(b.kredit) : ''}</td>
        <td class="angka">${rupiah(saldo)}</td>
      </tr>`;
  }

  return `
    <h3>${esc(akun.kode)} – ${esc(akun.nama)}
      <small class="abu">(${esc(akun.kategori)}, saldo normal ${akun.saldo_normal === 'D' ? 'Debit' : 'Kredit'})</small>
    </h3>
    <div class="tabel-wrap">
      <table class="tabel-akuntansi">
        <thead>
          <tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th>
              <th class="angka">Debit</th><th class="angka">Kredit</th><th class="angka">Saldo</th></tr>
        </thead>
        <tbody>${isi}</tbody>
        <tfoot>
          <tr>
            <td colspan="3">Mutasi periode &amp; saldo akhir</td>
            <td class="angka">${rupiah(totalDebit)}</td>
            <td class="angka">${rupiah(totalKredit)}</td>
            <td class="angka">${rupiah(saldo)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}
