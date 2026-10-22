/* ==================================================================
   DAFTAR UJI OTOMATIS — database Sistem Akuntansi Pendapatan Padel
   ------------------------------------------------------------------
   Setiap uji berisi:
     kelompok : judul kelompok uji
     nama     : apa yang dibuktikan
     sebagai  : siapa yang menjalankan
                'anon'        = pengunjung tanpa login
                'tanpa_peran' = login, tetapi tidak terdaftar di tabel pengguna
                'admin' / 'owner'
                'sistem'      = superuser (memeriksa hasil, tanpa RLS)
     jalankan : fungsi async (q) -> { lulus, info }
                q(sql) menjalankan SQL dan mengembalikan baris hasil.

   Setiap uji berjalan di dalam transaksi yang selalu di-ROLLBACK,
   jadi uji tidak saling memengaruhi dan data seed tetap utuh.
   Data yang dipakai berasal dari backend/seed.sql dan seed_tambahan.sql:
     booking 5 = hari ini 17:00, DP Rp 150.000 (QRIS)
     booking 6 = besok, belum bayar
     booking 7 = lusa, sudah lunas via transfer
     sewa 4    = 2 Raket Padel Pro masih dipinjam (denda Rp 750.000/unit)
   ================================================================== */

// Ubah angka jadi teks rupiah untuk keterangan hasil uji
const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

// Uji yang MENGHARAPKAN perintah ditolak database (muncul error).
// pola (opsional) = potongan pesan error yang diharapkan.
async function harapDitolak(q, sql, pola) {
  try {
    await q(sql);
    return { lulus: false, info: 'Perintah TIDAK ditolak' };
  } catch (e) {
    const cocok = !pola || new RegExp(pola, 'i').test(e.message);
    return { lulus: cocok, info: 'Ditolak: ' + e.message };
  }
}

// Tanggal hari Selasa (hari kerja) sekitar 30 hari lagi — bebas dari data seed
const SELASA = `(current_date + 30 + ((9 - extract(isodow from current_date + 30)::int) % 7))::date`;

// ---- Bantuan uji tutup buku ----
const BULAN_LALU = `(date_trunc('month', current_date) - interval '1 month')::date`;
const AKHIR_BULAN_LALU = `(date_trunc('month', current_date) - interval '1 day')::date`;
const UID = { owner: '00000000-0000-0000-0000-000000000001', admin: '00000000-0000-0000-0000-000000000002' };

// Di tengah uji 'sistem': mulai bertindak sebagai pengguna login (owner/admin)
async function jadiPengguna(q, peran) {
  await q(`set local role authenticated`);
  await q(`select set_config('request.jwt.claim.sub', '${UID[peran]}', true)`);
}

// Persiapan (sebagai superuser): tuntaskan semua booking bulan lalu yang belum
// selesai/batal, supaya bulan lalu memenuhi syarat untuk ditutup.
// Persiapan settlement: pastikan ada Saldo QRIS belum cair (bayar DP booking 6 via QRIS hari ini)
async function tambahPenerimaanQris(q) {
  await q(`insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values (6, current_date, 100000, 'qris')`);
}

async function tuntaskanBulanLalu(q) {
  await q(`update booking set status = 'selesai' where status = 'lunas' and tanggal < date_trunc('month', current_date)`);
  await q(`update booking set status = 'batal', alasan_batal = 'persiapan uji'
           where status in ('menunggu', 'dp') and tanggal < date_trunc('month', current_date)`);
}

export const daftarUji = [

  // ---------------------------------------------------------------
  // A. INTEGRITAS JURNAL (double-entry)
  // ---------------------------------------------------------------
  {
    kelompok: 'A. Integritas jurnal', nama: 'Total debit sama dengan total kredit', sebagai: 'sistem',
    jalankan: async (q) => {
      const [r] = await q(`select sum(debit) d, sum(kredit) k, count(distinct jurnal_id) n from jurnal_detail`);
      return { lulus: Number(r.d) > 0 && Number(r.d) === Number(r.k),
               info: `${r.n} jurnal · debit ${rp(r.d)} · kredit ${rp(r.k)}` };
    }
  },
  {
    kelompok: 'A. Integritas jurnal', nama: 'Tidak ada satu pun jurnal yang tidak seimbang', sebagai: 'sistem',
    jalankan: async (q) => {
      const [r] = await q(`select count(*) n from (select jurnal_id from jurnal_detail
                             group by jurnal_id having sum(debit) <> sum(kredit)) x`);
      return { lulus: Number(r.n) === 0, info: `${r.n} jurnal tidak seimbang` };
    }
  },
  {
    kelompok: 'A. Integritas jurnal', nama: 'Setiap jurnal tepat 1 baris debit + 1 baris kredit', sebagai: 'sistem',
    jalankan: async (q) => {
      const [r] = await q(`select count(*) n from (select jurnal_id from jurnal_detail group by jurnal_id
                             having count(*) <> 2 or count(*) filter (where debit > 0) <> 1) x`);
      return { lulus: Number(r.n) === 0, info: `${r.n} jurnal menyimpang` };
    }
  },
  {
    kelompok: 'A. Integritas jurnal', nama: 'Semua jurnal punya nomor bukti dan sumber transaksi', sebagai: 'sistem',
    jalankan: async (q) => {
      const [r] = await q(`select count(*) filter (where no_bukti is null or sumber is null or sumber_id is null) n,
                                  count(*) total from jurnal`);
      return { lulus: Number(r.n) === 0, info: `${r.n} dari ${r.total} jurnal tanpa no. bukti/sumber` };
    }
  },

  // ---------------------------------------------------------------
  // B. AKSES TANPA LOGIN (anon) — harus ditolak semua
  // ---------------------------------------------------------------
  {
    kelompok: 'B. Akses tanpa login', nama: 'Membaca data pelanggan (data pribadi) ditolak', sebagai: 'anon',
    jalankan: (q) => harapDitolak(q, `select * from pelanggan limit 1`, 'permission denied')
  },
  {
    kelompok: 'B. Akses tanpa login', nama: 'Membaca jurnal ditolak', sebagai: 'anon',
    jalankan: (q) => harapDitolak(q, `select * from v_jurnal_lengkap limit 1`, 'permission denied')
  },
  {
    kelompok: 'B. Akses tanpa login', nama: 'Membuat booking ditolak', sebagai: 'anon',
    jalankan: (q) => harapDitolak(q,
      `insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
       values (1, 1, current_date + 30, '08:00', '09:00')`, 'permission denied')
  },
  {
    kelompok: 'B. Akses tanpa login', nama: 'Memanggil fungsi hitung_tarif ditolak', sebagai: 'anon',
    jalankan: (q) => harapDitolak(q, `select * from hitung_tarif(1, current_date + 30, '08:00', '09:00')`,
      'permission denied')
  },

  // ---------------------------------------------------------------
  // C. PERAN, OTORISASI & JEJAK AUDIT
  // ---------------------------------------------------------------
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Akun login tanpa peran tidak melihat data apa pun', sebagai: 'tanpa_peran',
    jalankan: async (q) => {
      const [r] = await q(`select (select count(*) from booking) b, (select count(*) from pelanggan) p,
                                  (select count(*) from jurnal) j`);
      const total = Number(r.b) + Number(r.p) + Number(r.j);
      return { lulus: total === 0, info: `booking ${r.b}, pelanggan ${r.p}, jurnal ${r.j} baris terlihat` };
    }
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Admin tidak bisa mengubah tarif lapangan', sebagai: 'admin',
    jalankan: async (q) => {
      const rows = await q(`update lapangan set tarif_normal = 1 where id = 1 returning id`);
      return { lulus: rows.length === 0, info: `${rows.length} baris berubah` };
    }
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Owner bisa mengubah tarif lapangan', sebagai: 'owner',
    jalankan: async (q) => {
      const rows = await q(`update lapangan set tarif_normal = 210000 where id = 1 returning id`);
      return { lulus: rows.length === 1, info: `${rows.length} baris berubah` };
    }
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Menulis jurnal langsung dari aplikasi ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into jurnal (tanggal, keterangan, sumber) values (current_date, 'Jurnal palsu', 'manual')`)
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Memanggil buat_jurnal() langsung ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `select buat_jurnal(current_date, 'Palsu', 'manual', 1, '1-101', '4-201', 1000000)`, 'permission denied')
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Menghapus booking tidak mungkin (tanpa izin DELETE)', sebagai: 'admin',
    jalankan: async (q) => {
      try {
        const rows = await q(`delete from booking where id = 6 returning id`);
        return { lulus: rows.length === 0, info: `${rows.length} baris terhapus (diblokir RLS: tidak ada policy DELETE)` };
      } catch (e) {
        return { lulus: true, info: 'Ditolak: ' + e.message };
      }
    }
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Menulis riwayat status secara manual ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into riwayat_status_booking (booking_id, status_baru, keterangan) values (6, 'selesai', 'palsu')`)
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Refund oleh admin ditolak (refund khusus owner)', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `update booking set status = 'batal', metode_refund = 'transfer' where id = 7`, 'harus dilakukan oleh owner')
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Refund oleh owner berhasil: jurnal PDDM (D) / Bank (K)', sebagai: 'owner',
    jalankan: async (q) => {
      await q(`update booking set status = 'batal', metode_refund = 'transfer', alasan_batal = 'uji' where id = 7`);
      const [b] = await q(`select hasil_batal, total_harga from booking where id = 7`);
      const det = await q(`select jd.akun_kode, jd.debit, jd.kredit from jurnal_detail jd join jurnal j on j.id = jd.jurnal_id
                           where j.sumber = 'booking' and j.sumber_id = 7 order by jd.id`);
      const kredit = det.find(d => Number(d.kredit) > 0);
      const debit  = det.find(d => Number(d.debit) > 0);
      const ok = b.hasil_batal === 'refund' && debit?.akun_kode === '2-101'
              && kredit?.akun_kode === '1-102' && Number(kredit.kredit) === Number(b.total_harga);
      return { lulus: ok, info: `hasil ${b.hasil_batal}; D ${debit?.akun_kode} / K ${kredit?.akun_kode} ${rp(kredit?.kredit || 0)}` };
    }
  },
  {
    kelompok: 'C. Peran & otorisasi', nama: 'Jejak audit: pembuat booking & riwayat status tercatat otomatis', sebagai: 'admin',
    jalankan: async (q) => {
      await q(`insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai, dibuat_oleh)
               values (1, 3, current_date + 30, '07:00', '08:00', '00000000-0000-0000-0000-000000000001')`);
      const [b] = await q(`select b.dibuat_oleh, r.oleh, r.status_baru from booking b
                           join riwayat_status_booking r on r.booking_id = b.id
                           where b.id = (select max(id) from booking)`);
      const admin = '00000000-0000-0000-0000-000000000002';
      return { lulus: b.dibuat_oleh === admin && b.oleh === admin,
               info: `dibuat_oleh = ${b.dibuat_oleh === admin ? 'admin (isian palsu "owner" diabaikan)' : b.dibuat_oleh}; riwayat "${b.status_baru}"` };
    }
  },

  // ---------------------------------------------------------------
  // D. VALIDASI TRANSAKSI DI SERVER
  // ---------------------------------------------------------------
  {
    kelompok: 'D. Validasi transaksi', nama: 'Booking untuk tanggal yang sudah lewat ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
       values (1, 3, current_date - 1, '07:00', '08:00')`, 'sudah lewat')
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Booking yang bentrok jadwal ditolak', sebagai: 'admin',
    jalankan: async (q) => {
      await q(`insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
               values (1, 1, current_date + 30, '08:00', '10:00')`);
      return harapDitolak(q, `insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
               values (2, 1, current_date + 30, '09:00', '11:00')`, 'bentrok');
    }
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Tarif per jam: Selasa 16–18 Court A = 1 jam normal + 1 jam prime', sebagai: 'admin',
    jalankan: async (q) => {
      const [t] = await q(`select * from hitung_tarif(1, ${SELASA}, '16:00', '18:00')`);
      return { lulus: Number(t.total) === 500000 && t.jenis_tarif === 'campuran',
               info: `${t.jam_normal} jam normal + ${t.jam_prime} jam prime = ${rp(t.total)} (${t.jenis_tarif})` };
    }
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Pembayaran bertanggal besok ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values (6, current_date + 1, 100000, 'tunai')`,
      'masa depan')
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Admin mencatat pembayaran mundur 5 hari ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values (6, current_date - 5, 100000, 'tunai')`,
      'hanya boleh dicatat oleh owner')
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Owner boleh mencatat pembayaran mundur 5 hari', sebagai: 'owner',
    jalankan: async (q) => {
      const rows = await q(`insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
                            values (6, current_date - 5, 100000, 'tunai') returning jenis`);
      return { lulus: rows.length === 1, info: `tercatat sebagai "${rows[0]?.jenis}"` };
    }
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Pembayaran melebihi sisa tagihan ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
       select id, current_date, total_harga + 1, 'tunai' from booking where id = 6`, 'melebihi sisa tagihan')
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Sewa peralatan melebihi stok ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into sewa_peralatan (booking_id, peralatan_id, jumlah) values (6, 2, 100)`, 'tidak cukup')
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Jadwal/harga booking tidak bisa diubah', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q, `update booking set jam_mulai = '10:00', jam_selesai = '12:00' where id = 6`,
      'tidak boleh diubah')
  },
  {
    kelompok: 'D. Validasi transaksi', nama: 'Booking berstatus final (selesai) tidak bisa diubah', sebagai: 'owner',
    jalankan: (q) => harapDitolak(q, `update booking set status = 'batal' where id = 1`, 'tidak bisa diubah lagi')
  },

  // ---------------------------------------------------------------
  // E. LOGIKA AKUNTANSI (jurnal otomatis)
  // ---------------------------------------------------------------
  {
    kelompok: 'E. Logika akuntansi', nama: 'Pendapatan diakui saat booking selesai: PDDM (D) / Pendapatan Sewa (K)', sebagai: 'sistem',
    jalankan: async (q) => {
      const det = await q(`select jd.akun_kode, jd.debit, jd.kredit, b.total_harga from jurnal_detail jd
                           join jurnal j on j.id = jd.jurnal_id join booking b on b.id = j.sumber_id
                           where j.sumber = 'booking' and j.sumber_id = 2 order by jd.id`);
      const d = det.find(x => Number(x.debit) > 0), k = det.find(x => Number(x.kredit) > 0);
      return { lulus: d?.akun_kode === '2-101' && k?.akun_kode === '4-101' && Number(k.kredit) === Number(k.total_harga),
               info: `D ${d?.akun_kode} / K ${k?.akun_kode} ${rp(k?.kredit || 0)}` };
    }
  },
  {
    kelompok: 'E. Logika akuntansi', nama: 'Pembayaran QRIS dijurnal ke akun 1-103 Saldo QRIS', sebagai: 'admin',
    jalankan: async (q) => {
      await q(`insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values (6, current_date, 100000, 'qris')`);
      const det = await q(`select jd.akun_kode, jd.debit, jd.kredit from jurnal_detail jd join jurnal j on j.id = jd.jurnal_id
                           where j.sumber = 'pembayaran' and j.sumber_id = (select max(id) from pembayaran) order by jd.id`);
      const d = det.find(x => Number(x.debit) > 0), k = det.find(x => Number(x.kredit) > 0);
      return { lulus: d?.akun_kode === '1-103' && k?.akun_kode === '2-101',
               info: `D ${d?.akun_kode} / K ${k?.akun_kode} ${rp(d?.debit || 0)}` };
    }
  },
  {
    kelompok: 'E. Logika akuntansi', nama: 'Batal < 24 jam oleh admin: DP hangus → Pendapatan Lain-lain', sebagai: 'admin',
    jalankan: async (q) => {
      // raket yang dipinjam pada booking 5 dikembalikan dulu (syarat pembatalan)
      await q(`update sewa_peralatan set status_kembali = 'dikembalikan' where id = 4`);
      await q(`update booking set status = 'batal', alasan_batal = 'uji' where id = 5`);
      const [b] = await q(`select hasil_batal from booking where id = 5`);
      const det = await q(`select jd.akun_kode, jd.kredit from jurnal_detail jd join jurnal j on j.id = jd.jurnal_id
                           where j.sumber = 'booking' and j.sumber_id = 5 and jd.kredit > 0`);
      return { lulus: b.hasil_batal === 'hangus' && det[0]?.akun_kode === '4-201' && Number(det[0].kredit) === 150000,
               info: `hasil ${b.hasil_batal}; K ${det[0]?.akun_kode} ${rp(det[0]?.kredit || 0)}` };
    }
  },
  {
    kelompok: 'E. Logika akuntansi', nama: 'Menandai "selesai" sebelum jam main ditolak', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q, `update booking set status = 'selesai' where id = 7`, 'belum dimainkan')
  },
  {
    kelompok: 'E. Logika akuntansi', nama: 'Selesaikan massal: semua booking lunas yang lewat waktu diakui', sebagai: 'admin',
    jalankan: async (q) => {
      const [sebelum] = await q(`select count(*) n from v_booking_perlu_tindakan where tindakan = 'perlu_diselesaikan'`);
      const [hasil]   = await q(`select selesaikan_booking_lewat_waktu() n`);
      const [sesudah] = await q(`select count(*) n from v_booking_perlu_tindakan where tindakan = 'perlu_diselesaikan'`);
      return { lulus: Number(hasil.n) === Number(sebelum.n) && Number(sesudah.n) === 0,
               info: `${hasil.n}/${sebelum.n} booking diselesaikan; sisa ${sesudah.n}` };
    }
  },
  {
    kelompok: 'E. Logika akuntansi', nama: 'Denda dihitung server (isian denda palsu diabaikan)', sebagai: 'admin',
    jalankan: async (q) => {
      const [s] = await q(`update sewa_peralatan set status_kembali = 'rusak', jumlah_rusak = 1, denda = 999
                           where id = 4 returning denda`);
      const det = await q(`select jd.akun_kode, jd.kredit from jurnal_detail jd join jurnal j on j.id = jd.jurnal_id
                           where j.sumber = 'sewa_peralatan' and j.sumber_id = 4 and jd.akun_kode = '4-103'`);
      return { lulus: Number(s.denda) === 750000 && Number(det[0]?.kredit) === 750000,
               info: `isian 999 → denda ${rp(s.denda)}; jurnal 4-103 ${rp(det[0]?.kredit || 0)}` };
    }
  },
  {
    kelompok: 'E. Logika akuntansi', nama: 'Sisa paket member kedaluwarsa diakui (breakage) — paket Teguh', sebagai: 'owner',
    jalankan: async (q) => {
      await q(`select akui_breakage_paket()`);
      const [r] = await q(`select pp.nilai_breakage, pp.jam_total - pp.jam_terpakai sisa_jam,
                                  (select sum(jd.kredit) from jurnal_detail jd join jurnal j on j.id = jd.jurnal_id
                                    where j.sumber = 'pembelian_paket' and j.sumber_id = pp.id and jd.akun_kode = '4-104') jurnal
                           from pembelian_paket pp join pelanggan p on p.id = pp.pelanggan_id
                           where p.nama = 'Teguh Prasetyo' and pp.breakage_diakui`);
      return { lulus: !!r && Number(r.nilai_breakage) > 0 && Number(r.jurnal) === Number(r.nilai_breakage),
               info: r ? `sisa ${r.sisa_jam} jam = ${rp(r.nilai_breakage)}; jurnal 4-104 ${rp(r.jurnal || 0)}` : 'paket tidak ditemukan' };
    }
  },

  // ---------------------------------------------------------------
  // F. TUTUP BUKU (kunci periode)
  // ---------------------------------------------------------------
  {
    kelompok: 'F. Tutup buku', nama: 'Admin tidak bisa menutup buku', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q, `select tutup_periode(${BULAN_LALU})`, 'hanya boleh dilakukan oleh owner')
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Bulan berjalan tidak bisa ditutup', sebagai: 'owner',
    jalankan: (q) => harapDitolak(q, `select tutup_periode(current_date)`, 'sudah berakhir')
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Bulan yang masih punya booking belum tuntas tidak bisa ditutup', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      // satu booking bulan lalu yang belum dibayar (dibuat dari SQL Editor),
      // di lapangan khusus uji supaya pasti tidak bentrok dengan data seed
      await q(`insert into lapangan (nama, tarif_normal, tarif_prime) values ('Court Uji', 100000, 100000)`);
      await q(`insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
               select 1, id, ${AKHIR_BULAN_LALU}, '07:00', '08:00' from lapangan where nama = 'Court Uji'`);
      await jadiPengguna(q, 'owner');
      return harapDitolak(q, `select tutup_periode(${BULAN_LALU})`, 'belum dituntaskan');
    }
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Owner menutup bulan lalu: tercatat beserta riwayatnya', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      await jadiPengguna(q, 'owner');
      const [h] = await q(`select tutup_periode(${BULAN_LALU}) periode`);
      const [t] = await q(`select count(*) n, max(ditutup_oleh::text) oleh from tutup_buku`);
      const [r] = await q(`select aksi from riwayat_tutup_buku order by id desc limit 1`);
      return { lulus: Number(t.n) === 1 && t.oleh === UID.owner && r?.aksi === 'tutup',
               info: `periode ${h.periode} ditutup oleh owner; riwayat "${r?.aksi}"` };
    }
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Setelah ditutup: pembayaran bertanggal bulan itu ditolak (walau oleh owner)', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      await jadiPengguna(q, 'owner');
      await q(`select tutup_periode(${BULAN_LALU})`);
      return harapDitolak(q, `insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
                              values (6, ${AKHIR_BULAN_LALU}, 100000, 'tunai')`, 'sudah ditutup');
    }
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Lapisan terakhir: buat_jurnal() menolak tanggal di bulan tertutup', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      await q(`select tutup_periode(${BULAN_LALU})`);       // dari SQL Editor (superuser)
      return harapDitolak(q, `select buat_jurnal(${AKHIR_BULAN_LALU}, 'uji', 'manual', 1, '1-101', '4-201', 1000)`,
        'sudah ditutup');
    }
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Jurnal otomatis terlambat digeser ke bulan terbuka (breakage)', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      await q(`select tutup_periode(${BULAN_LALU})`);
      // Paket dibeli ±50 hari sebelum awal bulan ini -> kedaluwarsa di bulan lalu (sudah ditutup)
      await q(`insert into pembelian_paket (pelanggan_id, paket_id, tanggal_beli, metode_bayar)
               values (2, 1, (date_trunc('month', current_date) - interval '50 days')::date, 'tunai')`);
      await jadiPengguna(q, 'owner');
      await q(`select akui_breakage_paket()`);
      const [j] = await q(`select j.tanggal::text tanggal, j.keterangan, pp.tanggal_kadaluarsa::text kedaluwarsa,
                                  date_trunc('month', current_date)::date::text awal_bulan_ini
                           from jurnal j join pembelian_paket pp on pp.id = j.sumber_id
                           where j.sumber = 'pembelian_paket' and j.keterangan like 'Pengakuan sisa%'
                             and pp.id = (select max(id) from pembelian_paket)`);
      return { lulus: !!j && j.tanggal === j.awal_bulan_ini && j.keterangan.includes('(diakui terlambat)'),
               info: j ? `kedaluwarsa ${j.kedaluwarsa} → dijurnal ${j.tanggal}: "${j.keterangan}"` : 'jurnal tidak ditemukan' };
    }
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Admin tidak bisa membuka kembali periode', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      await q(`select tutup_periode(${BULAN_LALU})`);
      await jadiPengguna(q, 'admin');
      return harapDitolak(q, `select buka_periode(${BULAN_LALU}, 'salah tutup')`, 'hanya boleh dilakukan oleh owner');
    }
  },
  {
    kelompok: 'F. Tutup buku', nama: 'Buka kembali wajib alasan; dengan alasan berhasil & tercatat', sebagai: 'sistem',
    jalankan: async (q) => {
      await tuntaskanBulanLalu(q);
      await q(`select tutup_periode(${BULAN_LALU})`);
      await jadiPengguna(q, 'owner');
      await q(`savepoint sebelum_buka`);
      const tanpaAlasan = await harapDitolak(q, `select buka_periode(${BULAN_LALU}, '')`, 'wajib diisi');
      await q(`rollback to savepoint sebelum_buka`);
      await q(`select buka_periode(${BULAN_LALU}, 'Koreksi pembayaran yang terlewat')`);
      const [t] = await q(`select count(*) n from tutup_buku`);
      const [r] = await q(`select aksi, alasan from riwayat_tutup_buku order by id desc limit 1`);
      return { lulus: tanpaAlasan.lulus && Number(t.n) === 0 && r?.aksi === 'buka',
               info: `tanpa alasan: ${tanpaAlasan.lulus ? 'ditolak' : 'TIDAK ditolak'}; dengan alasan: dibuka, riwayat "${r?.aksi}: ${r?.alasan}"` };
    }
  },

  // ---------------------------------------------------------------
  // G. SETTLEMENT QRIS (pencairan Saldo QRIS ke Bank + biaya MDR)
  // ---------------------------------------------------------------
  {
    kelompok: 'G. Settlement QRIS', nama: 'Data demo: saldo QRIS cocok dengan jurnal dan umur saldo terlacak', sebagai: 'sistem',
    jalankan: async (q) => {
      const [r] = await q(`select v.saldo_belum_cair, v.belum_cair_sejak::text sejak, v.settlement_terakhir::text terakhir,
                                  (select sum(debit - kredit) from jurnal_detail where akun_kode = '1-103') saldo_jurnal,
                                  (select count(*) from settlement_qris) n,
                                  date_trunc('week', current_date)::date::text awal_minggu
                           from v_ringkasan_qris v`);
      const ok = Number(r.n) > 0 && Number(r.saldo_belum_cair) === Number(r.saldo_jurnal) && Number(r.saldo_belum_cair) >= 0
              && (r.sejak === null || r.sejak >= r.awal_minggu);
      return { lulus: ok, info: `${r.n} settlement contoh; saldo belum cair ${rp(r.saldo_belum_cair)} (= jurnal 1-103), sejak ${r.sejak ?? '-'}, terakhir ${r.terakhir}` };
    }
  },
  {
    kelompok: 'G. Settlement QRIS', nama: 'Admin tidak bisa mencatat settlement (pemisahan tugas)', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih)
       values (current_date, 'STL-UJI-ADMIN', 1000, 1000)`, 'hanya boleh dicatat oleh owner')
  },
  {
    kelompok: 'G. Settlement QRIS', nama: 'Owner: 2 jurnal otomatis, MDR dihitung server (isian palsu diabaikan)', sebagai: 'owner',
    jalankan: async (q) => {
      await tambahPenerimaanQris(q);
      const [s] = await q(`select least(saldo_belum_cair, 200000) bruto from v_ringkasan_qris`);
      const bruto = Number(s.bruto), bersih = bruto - 600;
      const [ins] = await q(`insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih, biaya_mdr)
                             values (current_date, 'STL-UJI-1', ${bruto}, ${bersih}, 1) returning id, biaya_mdr`);
      const det = await q(`select jd.akun_kode, sum(jd.debit) d, sum(jd.kredit) k from jurnal_detail jd join jurnal j on j.id = jd.jurnal_id
                           where j.sumber = 'settlement_qris' and j.sumber_id = ${ins.id} group by jd.akun_kode`);
      const akun = Object.fromEntries(det.map(x => [x.akun_kode, x]));
      const ok = Number(ins.biaya_mdr) === 600 && Number(akun['1-102']?.d) === bersih
              && Number(akun['6-101']?.d) === 600 && Number(akun['1-103']?.k) === bruto;
      return { lulus: ok, info: `kotor ${rp(bruto)} → Bank (D) ${rp(akun['1-102']?.d || 0)}, Beban MDR (D) ${rp(akun['6-101']?.d || 0)}, `
                              + `Saldo QRIS (K) ${rp(akun['1-103']?.k || 0)}; isian MDR 1 → ${rp(ins.biaya_mdr)}` };
    }
  },
  {
    kelompok: 'G. Settlement QRIS', nama: 'Jumlah kotor melebihi Saldo QRIS belum cair ditolak', sebagai: 'owner',
    jalankan: async (q) => {
      const [s] = await q(`select saldo_belum_cair + 1 lebih from v_ringkasan_qris`);
      return harapDitolak(q, `insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih)
                              values (current_date, 'STL-UJI-2', ${Number(s.lebih)}, ${Number(s.lebih)})`, 'melebihi Saldo QRIS');
    }
  },
  {
    kelompok: 'G. Settlement QRIS', nama: 'Jumlah masuk Bank lebih besar dari jumlah kotor ditolak', sebagai: 'owner',
    jalankan: (q) => harapDitolak(q,
      `insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih)
       values (current_date, 'STL-UJI-3', 1000, 1500)`, 'tidak boleh lebih besar')
  },
  {
    kelompok: 'G. Settlement QRIS', nama: 'Nomor referensi yang sama tidak bisa dicatat dua kali', sebagai: 'owner',
    jalankan: async (q) => {
      await tambahPenerimaanQris(q);
      await q(`insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih)
               values (current_date, 'STL-UJI-4', 1000, 997)`);
      return harapDitolak(q, `insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih)
               values (current_date, 'STL-UJI-4', 1000, 997)`, 'sudah pernah dicatat');
    }
  },

  // ---------------------------------------------------------------
  // H. PERBAIKAN HASIL REVIEW AKHIR (R1-R5)
  // ---------------------------------------------------------------
  {
    kelompok: 'H. Perbaikan review akhir', nama: 'R1: kode booking & no. bukti tidak terpotong saat id panjang', sebagai: 'sistem',
    jalankan: async (q) => {
      await q(`select setval(pg_get_serial_sequence('booking', 'id'), 99999)`);
      await q(`select setval(pg_get_serial_sequence('jurnal', 'id'), 123455)`);
      const [b] = await q(`insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
                           values (1, 3, current_date + 40, '07:00', '08:00') returning id, kode_booking`);
      const [baru] = await q(`select buat_jurnal(current_date, 'uji', 'manual', 1, '1-101', '4-201', 1000) id`);
      const [j] = await q(`select no_bukti from jurnal where id = ${baru.id}`);
      const ok = b.kode_booking.endsWith('-100000') && j.no_bukti === 'JU-123456';
      return { lulus: ok, info: `id ${b.id} → ${b.kode_booking}; jurnal id 123456 → ${j.no_bukti}` };
    }
  },
  {
    kelompok: 'H. Perbaikan review akhir', nama: 'R2: settlement bertanggal mundur melebihi saldo per tanggal itu ditolak', sebagai: 'owner',
    jalankan: async (q) => {
      await tambahPenerimaanQris(q);   // penerimaan hari ini belum ada 3 hari lalu
      const [s] = await q(`select saldo_belum_cair from v_ringkasan_qris`);
      return harapDitolak(q, `insert into settlement_qris (tanggal, no_referensi, jumlah_bruto, jumlah_bersih)
                              values (current_date - 3, 'STL-MUNDUR', ${Number(s.saldo_belum_cair)}, ${Number(s.saldo_belum_cair)})`,
        'tersedia per');
    }
  },
  {
    kelompok: 'H. Perbaikan review akhir', nama: 'R3: booking dengan peralatan masih dipinjam tidak bisa dibatalkan', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q, `update booking set status = 'batal' where id = 5`, 'masih punya peralatan')
  },
  {
    kelompok: 'H. Perbaikan review akhir', nama: 'R4: waktu pencatatan pembayaran diisi server (isian palsu diabaikan)', sebagai: 'admin',
    jalankan: async (q) => {
      const [p] = await q(`insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar, created_at)
                           values (6, current_date, 50000, 'tunai', '2020-01-01') returning created_at::date::text tgl,
                           current_date::text hari_ini`);
      return { lulus: p.tgl === p.hari_ini, info: `isian 2020-01-01 → tercatat ${p.tgl}` };
    }
  },
  {
    kelompok: 'H. Perbaikan review akhir', nama: 'R4: id transaksi tidak bisa diisi dari aplikasi', sebagai: 'admin',
    jalankan: (q) => harapDitolak(q,
      `insert into booking (id, pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai)
       values (900000, 1, 3, current_date + 40, '07:00', '08:00')`, 'non-DEFAULT')
  },
  {
    kelompok: 'H. Perbaikan review akhir', nama: 'R5: pengguna login tidak punya hak DELETE / TRUNCATE', sebagai: 'sistem',
    jalankan: async (q) => {
      const [r] = await q(`select has_table_privilege('authenticated', 'public.booking', 'DELETE')   del_booking,
                                  has_table_privilege('authenticated', 'public.booking', 'TRUNCATE') trunc_booking,
                                  has_table_privilege('authenticated', 'public.jurnal',  'DELETE')   del_jurnal,
                                  has_table_privilege('authenticated', 'public.jurnal',  'TRUNCATE') trunc_jurnal,
                                  has_table_privilege('authenticated', 'public.booking', 'INSERT')   ins_booking`);
      const ok = !r.del_booking && !r.trunc_booking && !r.del_jurnal && !r.trunc_jurnal && r.ins_booking;
      return { lulus: ok, info: `DELETE/TRUNCATE booking: ${r.del_booking}/${r.trunc_booking}; jurnal: ${r.del_jurnal}/${r.trunc_jurnal}; INSERT booking tetap: ${r.ins_booking}` };
    }
  }
];
