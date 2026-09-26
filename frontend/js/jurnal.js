/* ==================================================================
   JURNAL UMUM
   Menampilkan jurnal yang dibuat otomatis oleh trigger.
   Format: akun debit di atas, akun kredit menjorok ke kanan,
   lalu keterangan transaksi. Di bawah ada total debit & kredit
   yang harus SAMA (seimbang).
   ================================================================== */

function siapkanJurnal() {
  $('ju-dari').value = tambahHari(hariIni(), -30);
  $('ju-sampai').value = hariIni();
  $('ju-tampil').addEventListener('click', muatJurnal);
}

async function muatJurnal() {
  skeletonTabel('ju-isi', 6, 6);   // kotak berkilau saat pertama kali dimuat (animasi.js)
  // ambilSemua: jurnal bisa lebih dari 1.000 baris (lihat app.js)
  const { data, error } = await ambilSemua(() => db.from('v_jurnal_lengkap').select('*')
    .gte('tanggal', $('ju-dari').value).lte('tanggal', $('ju-sampai').value)
    .order('tanggal').order('jurnal_id')
    .order('debit', { ascending: false })     // baris debit dulu, baru kredit
    .order('id'));
  if (adaError(error)) return;

  if (data.length === 0) {
    $('ju-isi').innerHTML = barisKosong(6, 'Tidak ada jurnal pada periode ini');
    $('ju-total').innerHTML = '';
    return;
  }

  // Kelompokkan baris detail berdasarkan jurnal_id
  const kelompok = new Map();
  for (const baris of data) {
    if (!kelompok.has(baris.jurnal_id)) kelompok.set(baris.jurnal_id, []);
    kelompok.get(baris.jurnal_id).push(baris);
  }

  let html = '';
  let totalDebit = 0;
  let totalKredit = 0;

  for (const detail of kelompok.values()) {
    const kepala = detail[0];
    detail.forEach((d, i) => {
      totalDebit += Number(d.debit);
      totalKredit += Number(d.kredit);
      html += `
        <tr class="${i === 0 ? 'baris-header' : ''}">
          <td>${i === 0 ? tanggalIndo(kepala.tanggal) : ''}</td>
          <td>${i === 0 ? esc(kepala.no_bukti) : ''}</td>
          <td class="${d.kredit > 0 ? 'akun-kredit' : ''}">${esc(d.nama_akun)}</td>
          <td>${esc(d.akun_kode)}</td>
          <td class="angka">${d.debit > 0 ? rupiah(d.debit) : ''}</td>
          <td class="angka">${d.kredit > 0 ? rupiah(d.kredit) : ''}</td>
        </tr>`;
    });
    html += `<tr><td></td><td></td><td colspan="4"><small class="abu"><i>(${esc(kepala.keterangan)})</i></small></td></tr>`;
  }

  $('ju-isi').innerHTML = html;
  const seimbang = Math.abs(totalDebit - totalKredit) < 0.01;
  $('ju-total').innerHTML = `
    <tr>
      <td colspan="4">Total &nbsp;${seimbang
        ? '<span class="badge badge-selesai"><i class="ti ti-check"></i> Seimbang</span>'
        : '<span class="badge badge-batal"><i class="ti ti-x"></i> Tidak seimbang</span>'}</td>
      <td class="angka">${rupiah(totalDebit)}</td>
      <td class="angka">${rupiah(totalKredit)}</td>
    </tr>`;
}
