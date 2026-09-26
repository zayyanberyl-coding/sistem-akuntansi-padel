-- =====================================================================
--  DATA CONTOH (SEED)
--  Sistem Akuntansi Pendapatan Sewa Lapangan Padel - Smash Padel Club
-- ---------------------------------------------------------------------
--  Jalankan TERAKHIR, setelah schema.sql dan triggers.sql,
--  pada tabel yang masih KOSONG (baru dibuat).
--
--  Tanggal transaksi memakai current_date (hari ini) +/- beberapa hari,
--  jadi dashboard selalu punya data "bulan ini" kapan pun file dijalankan.
--
--  PENTING: jurnal TIDAK diisi manual di sini. Jurnal terbentuk otomatis
--  oleh trigger ketika data booking/pembayaran/sewa dimasukkan.
--  Itu sekaligus membuktikan bahwa trigger berjalan dengan benar.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. BAGAN AKUN (Chart of Accounts)
-- ---------------------------------------------------------------------
insert into akun (kode, nama, kategori, saldo_normal) values
  ('1-101', 'Kas',                          'Aset',       'D'),
  ('2-101', 'Pendapatan Diterima di Muka',  'Kewajiban',  'K'),
  ('4-101', 'Pendapatan Sewa Lapangan',     'Pendapatan', 'K'),
  ('4-102', 'Pendapatan Sewa Peralatan',    'Pendapatan', 'K'),
  ('4-103', 'Pendapatan Denda',             'Pendapatan', 'K'),
  ('4-201', 'Pendapatan Lain-lain',         'Pendapatan', 'K');


-- ---------------------------------------------------------------------
-- 2. DATA MASTER
--    id ditulis manual supaya mudah dirujuk oleh data transaksi di bawah.
-- ---------------------------------------------------------------------
insert into lapangan (id, nama, jenis, tarif_normal, tarif_prime) values
  (1, 'Court A', 'indoor',  200000, 300000),
  (2, 'Court B', 'indoor',  200000, 300000),
  (3, 'Court C', 'outdoor', 150000, 225000);

insert into pelanggan (id, nama, no_hp, email, tanggal_daftar) values
  (1, 'Andi Pratama',     '081234567801', 'andi@contoh.com',  current_date - 30),
  (2, 'Siti Rahmawati',   '081234567802', 'siti@contoh.com',  current_date - 25),
  (3, 'Budi Santoso',     '081234567803', null,               current_date - 20),
  (4, 'Dewi Lestari',     '081234567804', 'dewi@contoh.com',  current_date - 15),
  (5, 'Rizky Maulana',    '081234567805', null,               current_date - 10),
  (6, 'Nadia Putri',      '081234567806', 'nadia@contoh.com', current_date - 5);

insert into paket_member (id, nama_paket, jumlah_jam, harga, masa_berlaku_hari) values
  (1, 'Paket Silver 5 Jam',  5,  900000, 30),   -- Rp 180.000 / jam
  (2, 'Paket Gold 10 Jam',  10, 1700000, 60);   -- Rp 170.000 / jam

insert into peralatan (id, nama, jenis, tarif_sewa, denda_rusak, stok) values
  (1, 'Raket Padel Standar',        'raket', 25000, 350000, 10),
  (2, 'Raket Padel Pro',            'raket', 40000, 750000,  6),
  (3, 'Bola Padel (1 tabung isi 3)', 'bola', 15000,  45000, 30);


-- ---------------------------------------------------------------------
-- 3. TRANSAKSI (mengikuti alur nyata aplikasi)
-- ---------------------------------------------------------------------

-- Paket member: Dewi membeli Paket Silver 10 hari lalu
--   -> jurnal: Kas (D) / Pendapatan Diterima di Muka (K)
insert into pembelian_paket (id, pelanggan_id, paket_id, tanggal_beli, metode_bayar) values
  (1, 4, 1, current_date - 10, 'transfer');

-- Booking (harga & status dihitung trigger)
insert into booking (id, pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai, pembelian_paket_id) values
  (1, 1, 1, current_date - 6, '08:00', '10:00', null),  -- DP lalu lunas, selesai
  (2, 2, 2, current_date - 5, '18:00', '20:00', null),  -- langsung lunas, selesai
  (3, 3, 1, current_date - 3, '19:00', '21:00', null),  -- DP lalu BATAL (DP hangus)
  (4, 4, 3, current_date - 4, '16:00', '18:00', 1),     -- pakai paket member, selesai
  (5, 5, 1, current_date,     '17:00', '19:00', null),  -- hari ini, baru DP
  (6, 6, 2, current_date + 1, '09:00', '11:00', null),  -- besok, belum bayar
  (7, 1, 3, current_date + 2, '10:00', '12:00', null),  -- lusa, sudah lunas
  (8, 4, 2, current_date + 3, '07:00', '08:00', 1);     -- pakai paket member (belum main)

-- Pembayaran -> jurnal: Kas (D) / Pendapatan Diterima di Muka (K)
-- Booking 1: DP Rp 100.000, lalu pelunasan sisanya
insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values
  (1, current_date - 7, 100000, 'transfer');
insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
  select id, current_date - 6, total_harga - 100000, 'tunai' from booking where id = 1;

-- Booking 2: langsung bayar penuh
insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
  select id, current_date - 5, total_harga, 'qris' from booking where id = 2;

-- Booking 3: DP Rp 150.000
insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values
  (3, current_date - 4, 150000, 'transfer');

-- Booking 5: DP Rp 150.000
insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar) values
  (5, current_date - 1, 150000, 'qris');

-- Booking 7: lunas di muka
insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
  select id, current_date, total_harga, 'transfer' from booking where id = 7;

-- Sewa peralatan -> stok berkurang + jurnal Kas (D) / Pendapatan Sewa Peralatan (K)
insert into sewa_peralatan (id, booking_id, peralatan_id, jumlah, tanggal_sewa) values
  (1, 1, 1, 2, current_date - 6),   -- 2 raket standar
  (2, 2, 1, 4, current_date - 5),   -- 4 raket standar
  (3, 2, 3, 1, current_date - 5),   -- 1 tabung bola
  (4, 5, 2, 2, current_date);       -- 2 raket pro (masih dipinjam)

-- Pengembalian peralatan -> stok bertambah lagi
update sewa_peralatan set status_kembali = 'dikembalikan', tanggal_kembali = current_date - 6 where id = 1;
update sewa_peralatan set status_kembali = 'dikembalikan', tanggal_kembali = current_date - 5 where id = 3;
-- 1 raket rusak -> denda otomatis Rp 350.000, jurnal Kas (D) / Pendapatan Denda (K)
update sewa_peralatan set status_kembali = 'rusak', jumlah_rusak = 1, tanggal_kembali = current_date - 5 where id = 2;

-- Booking selesai dimainkan -> jurnal Pendapatan Diterima di Muka (D) / Pendapatan Sewa Lapangan (K)
update booking set status = 'selesai' where id in (1, 2, 4);

-- Booking batal -> DP hangus: Pendapatan Diterima di Muka (D) / Pendapatan Lain-lain (K)
update booking set status = 'batal', catatan = 'Pelanggan berhalangan' where id = 3;


-- ---------------------------------------------------------------------
-- 4. SESUAIKAN PENGHITUNG ID
--    Karena id di atas ditulis manual, penghitung otomatisnya perlu
--    dimajukan agar data baru dari aplikasi tidak bentrok id-nya.
-- ---------------------------------------------------------------------
select setval(pg_get_serial_sequence('lapangan',        'id'), (select max(id) from lapangan));
select setval(pg_get_serial_sequence('pelanggan',       'id'), (select max(id) from pelanggan));
select setval(pg_get_serial_sequence('paket_member',    'id'), (select max(id) from paket_member));
select setval(pg_get_serial_sequence('peralatan',       'id'), (select max(id) from peralatan));
select setval(pg_get_serial_sequence('pembelian_paket', 'id'), (select max(id) from pembelian_paket));
select setval(pg_get_serial_sequence('booking',         'id'), (select max(id) from booking));
select setval(pg_get_serial_sequence('sewa_peralatan',  'id'), (select max(id) from sewa_peralatan));


-- ---------------------------------------------------------------------
-- 5. CEK HASIL: total debit harus SAMA dengan total kredit
-- ---------------------------------------------------------------------
select sum(debit) as total_debit, sum(kredit) as total_kredit from jurnal_detail;
