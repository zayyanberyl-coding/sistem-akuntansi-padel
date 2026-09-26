-- =====================================================================
--  DATA TAMBAHAN (supaya dashboard & laporan terlihat realistis)
--  Sistem Akuntansi Pendapatan Sewa Lapangan Padel - Smash Padel Club
-- ---------------------------------------------------------------------
--  Jalankan SETELAH seed.sql, CUKUP SEKALI.
--
--  Isi:
--   - 25 pelanggan baru + 8 pembelian paket member
--   - booking 45 hari ke belakang s.d. 10 hari ke depan, dengan pola:
--       * sore-malam (prime time) lebih ramai daripada siang
--       * Sabtu-Minggu lebih ramai daripada hari kerja
--   - pembayaran DP / pelunasan, booking selesai, sebagian kecil batal
--   - sewa peralatan (sesekali ada yang rusak -> denda)
--
--  Semua data dimasukkan lewat alur normal, jadi JURNAL dibuat otomatis
--  oleh trigger (tidak ada jurnal yang diketik manual).
--  random() diberi setseed supaya hasilnya selalu sama tiap dijalankan.
-- =====================================================================

do $$
declare
  v_hari       int;          -- selisih hari dari hari ini (-45 .. 10)
  v_tanggal    date;
  v_weekend    boolean;
  v_lap        record;
  v_jam        int;          -- jam mulai yang sedang dicoba
  v_durasi     int;
  v_peluang    numeric;      -- peluang jam tersebut dibooking (0 - 1)
  v_pelanggan  bigint[];     -- daftar id pelanggan
  v_pel        bigint;
  v_paket      bigint;
  v_booking    booking%rowtype;
  v_metode     text[] := array['tunai', 'transfer', 'qris'];
  v_acak       numeric;
  v_alat       peralatan%rowtype;
  v_jumlah     int;
  v_sewa_id    bigint;
begin
  -- Cegah dijalankan dua kali
  if exists (select 1 from pelanggan where nama = 'Fajar Nugroho') then
    raise exception 'seed_tambahan.sql sudah pernah dijalankan.';
  end if;

  perform setseed(0.2026);

  -- -----------------------------------------------------------------
  -- 1. Pelanggan baru
  -- -----------------------------------------------------------------
  insert into pelanggan (nama, no_hp, email, tanggal_daftar) values
    ('Fajar Nugroho',     '081311120001', 'fajar@contoh.com',   current_date - 60),
    ('Intan Permata',     '081311120002', 'intan@contoh.com',   current_date - 58),
    ('Kevin Wijaya',      '081311120003', null,                 current_date - 57),
    ('Laras Ayuningtyas', '081311120004', 'laras@contoh.com',   current_date - 55),
    ('Michael Tanoto',    '081311120005', 'michael@contoh.com', current_date - 54),
    ('Putri Anjani',      '081311120006', null,                 current_date - 52),
    ('Raka Aditya',       '081311120007', 'raka@contoh.com',    current_date - 50),
    ('Salsabila Zahra',   '081311120008', null,                 current_date - 49),
    ('Teguh Prasetyo',    '081311120009', 'teguh@contoh.com',   current_date - 47),
    ('Vania Kusuma',      '081311120010', 'vania@contoh.com',   current_date - 45),
    ('Wahyu Hidayat',     '081311120011', null,                 current_date - 44),
    ('Yohana Siregar',    '081311120012', 'yohana@contoh.com',  current_date - 42),
    ('Arief Rahman',      '081311120013', null,                 current_date - 40),
    ('Bella Oktaviani',   '081311120014', 'bella@contoh.com',   current_date - 38),
    ('Chandra Gunawan',   '081311120015', 'chandra@contoh.com', current_date - 36),
    ('Dimas Saputra',     '081311120016', null,                 current_date - 33),
    ('Elisa Hartono',     '081311120017', 'elisa@contoh.com',   current_date - 30),
    ('Gilang Ramadhan',   '081311120018', null,                 current_date - 28),
    ('Hana Pertiwi',      '081311120019', 'hana@contoh.com',    current_date - 25),
    ('Ivan Setiawan',     '081311120020', null,                 current_date - 22),
    ('Jessica Halim',     '081311120021', 'jessica@contoh.com', current_date - 20),
    ('Kurniawan Adi',     '081311120022', null,                 current_date - 16),
    ('Maya Safitri',      '081311120023', 'maya@contoh.com',    current_date - 12),
    ('Nando Pratama',     '081311120024', null,                 current_date - 8),
    ('Oktavia Lestari',   '081311120025', 'okta@contoh.com',    current_date - 4);

  select array_agg(id order by id) into v_pelanggan from pelanggan;

  -- -----------------------------------------------------------------
  -- 2. Pembelian paket member
  --    Jurnal otomatis: Kas (D) / Pendapatan Diterima di Muka (K)
  -- -----------------------------------------------------------------
  insert into pembelian_paket (pelanggan_id, paket_id, tanggal_beli, metode_bayar)
  select p.id, x.paket_id, current_date - x.hari_lalu, x.metode
  from (values
      ('Fajar Nugroho',   2, 50, 'transfer'),
      ('Laras Ayuningtyas', 1, 44, 'qris'),
      ('Michael Tanoto',  2, 40, 'transfer'),
      ('Vania Kusuma',    1, 30, 'tunai'),
      ('Chandra Gunawan', 2, 25, 'transfer'),
      ('Elisa Hartono',   1, 18, 'qris'),
      ('Raka Aditya',     1, 12, 'transfer'),
      ('Jessica Halim',   2,  6, 'qris')
    ) as x(nama, paket_id, hari_lalu, metode)
  join pelanggan p on p.nama = x.nama;

  -- -----------------------------------------------------------------
  -- 3. Tambah stok peralatan (pembelian stok baru)
  -- -----------------------------------------------------------------
  update peralatan set stok = stok + 8  where jenis = 'raket';
  update peralatan set stok = stok + 20 where jenis = 'bola';

  -- -----------------------------------------------------------------
  -- 4. Booking harian
  -- -----------------------------------------------------------------
  for v_hari in -45 .. 10 loop
    v_tanggal := current_date + v_hari;
    v_weekend := extract(dow from v_tanggal) in (0, 6);

    for v_lap in select id from lapangan where aktif order by id loop
      v_jam := 7;
      while v_jam < 23 loop
        -- Peluang dibooking per jam (prime time sore-malam paling ramai)
        v_peluang := case
                       when v_jam < 11 then 0.14   -- pagi
                       when v_jam < 16 then 0.08   -- siang (sepi)
                       when v_jam < 17 then 0.30   -- menjelang sore
                       when v_jam < 22 then 0.55   -- prime time
                       else 0.20                    -- malam
                     end
                     + case when v_weekend then 0.20 else 0 end;
        if v_hari > 3 then
          v_peluang := v_peluang * 0.45;            -- jauh ke depan: belum banyak yang pesan
        end if;

        if random() >= v_peluang then
          v_jam := v_jam + 1;
          continue;
        end if;

        v_durasi := case when random() < 0.55 then 1 else 2 end;
        if v_jam + v_durasi > 23 then
          v_durasi := 23 - v_jam;
        end if;

        -- Lewati jika bentrok dengan booking yang sudah ada (misal dari seed.sql)
        if exists (
          select 1 from booking
          where lapangan_id = v_lap.id and tanggal = v_tanggal and status <> 'batal'
            and jam_mulai < make_time(v_jam + v_durasi, 0, 0)
            and jam_selesai > make_time(v_jam, 0, 0)
        ) then
          v_jam := v_jam + 1;
          continue;
        end if;

        -- Pilih pelanggan acak; pakai paket member jika punya & masih cukup
        v_pel := v_pelanggan[1 + floor(random() * array_length(v_pelanggan, 1))::int];
        v_paket := null;
        select id into v_paket
        from pembelian_paket
        where pelanggan_id = v_pel
          and v_tanggal between tanggal_beli and tanggal_kadaluarsa
          and jam_total - jam_terpakai >= v_durasi
        order by tanggal_beli
        limit 1;

        insert into booking (pelanggan_id, lapangan_id, tanggal, jam_mulai, jam_selesai, pembelian_paket_id)
        values (v_pel, v_lap.id, v_tanggal, make_time(v_jam, 0, 0), make_time(v_jam + v_durasi, 0, 0), v_paket)
        returning * into v_booking;

        v_acak := random();

        -- ---------- Booking yang sudah lewat ----------
        if v_hari < 0 then
          if v_paket is null then
            if v_acak < 0.07 then
              -- Bayar DP lalu batal -> DP hangus
              insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
              values (v_booking.id, v_tanggal - (1 + floor(random() * 4))::int,
                      round(v_booking.total_harga * 0.5), v_metode[1 + floor(random() * 3)::int]);
              update booking set status = 'batal', catatan = 'Pelanggan tidak datang' where id = v_booking.id;
            else
              if v_acak < 0.62 then
                -- DP 50% beberapa hari sebelumnya, pelunasan saat datang
                insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
                values (v_booking.id, v_tanggal - (1 + floor(random() * 4))::int,
                        round(v_booking.total_harga * 0.5), v_metode[1 + floor(random() * 3)::int]);
              end if;
              -- Pelunasan (atau langsung bayar penuh) di hari main
              insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
              select v_booking.id, v_tanggal, v_booking.total_harga - coalesce(sum(jumlah), 0),
                     v_metode[1 + floor(random() * 3)::int]
              from pembayaran where booking_id = v_booking.id;

              update booking set status = 'selesai' where id = v_booking.id;
            end if;
          else
            -- Booking member: hampir semua dimainkan
            if v_acak < 0.05 then
              update booking set status = 'batal', catatan = 'Jadwal member dibatalkan' where id = v_booking.id;
            else
              update booking set status = 'selesai' where id = v_booking.id;
            end if;
          end if;

          -- Sewa peralatan untuk sebagian booking yang dimainkan
          if random() < 0.45 and (select status from booking where id = v_booking.id) = 'selesai' then
            select * into v_alat from peralatan order by random() limit 1;
            v_jumlah := case when v_alat.jenis = 'bola' then 1 + floor(random() * 2)::int
                             else 2 + floor(random() * 3)::int end;
            if v_alat.stok >= v_jumlah then
              insert into sewa_peralatan (booking_id, peralatan_id, jumlah, tanggal_sewa)
              values (v_booking.id, v_alat.id, v_jumlah, v_tanggal)
              returning id into v_sewa_id;

              if random() < 0.04 then
                update sewa_peralatan set status_kembali = 'rusak', jumlah_rusak = 1, tanggal_kembali = v_tanggal
                where id = v_sewa_id;          -- denda otomatis
              else
                update sewa_peralatan set status_kembali = 'dikembalikan', tanggal_kembali = v_tanggal
                where id = v_sewa_id;
              end if;
            end if;
          end if;

        -- ---------- Hari ini & ke depan ----------
        elsif v_paket is null then
          if v_acak < 0.40 then
            -- sudah DP
            insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
            values (v_booking.id, current_date - floor(random() * 3)::int,
                    round(v_booking.total_harga * 0.5), v_metode[1 + floor(random() * 3)::int]);
          elsif v_acak < 0.65 then
            -- sudah lunas di muka
            insert into pembayaran (booking_id, tanggal, jumlah, metode_bayar)
            values (v_booking.id, current_date - floor(random() * 3)::int,
                    v_booking.total_harga, v_metode[1 + floor(random() * 3)::int]);
          end if;
          -- sisanya masih 'menunggu' pembayaran
        end if;

        v_jam := v_jam + v_durasi;
      end loop;
    end loop;
  end loop;

  -- -----------------------------------------------------------------
  -- 5. Rapikan tanggal jurnal "DP hangus"
  --    Trigger memakai tanggal hari ini (saat tombol Batal ditekan).
  --    Untuk data contoh, tanggalnya disamakan dengan tanggal main.
  -- -----------------------------------------------------------------
  update jurnal j
     set tanggal = b.tanggal
    from booking b
   where j.sumber = 'booking' and j.sumber_id = b.id
     and b.status = 'batal' and j.keterangan like 'DP hangus%'
     and b.tanggal < current_date;
end;
$$;


-- ---------------------------------------------------------------------
-- CEK HASIL
-- ---------------------------------------------------------------------
select
  (select count(*) from pelanggan)                          as jumlah_pelanggan,
  (select count(*) from booking)                            as jumlah_booking,
  (select count(*) from booking where status = 'selesai')   as booking_selesai,
  (select count(*) from jurnal)                             as jumlah_jurnal,
  (select sum(debit)  from jurnal_detail)                   as total_debit,
  (select sum(kredit) from jurnal_detail)                   as total_kredit;
