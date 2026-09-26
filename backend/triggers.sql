-- =====================================================================
--  FUNGSI & TRIGGER (JURNAL OTOMATIS)
--  Sistem Akuntansi Pendapatan Sewa Lapangan Padel - Smash Padel Club
-- ---------------------------------------------------------------------
--  Jalankan SETELAH schema.sql.
--
--  Apa itu TRIGGER? Fungsi yang otomatis dijalankan database setiap kali
--  ada INSERT / UPDATE pada tabel tertentu. Dengan trigger, jurnal
--  akuntansi selalu tercatat walaupun frontend lupa membuatnya.
--
--  Kode akun yang dipakai (lihat seed.sql):
--    1-101  Kas
--    2-101  Pendapatan Diterima di Muka   (kewajiban / utang jasa)
--    4-101  Pendapatan Sewa Lapangan
--    4-102  Pendapatan Sewa Peralatan
--    4-103  Pendapatan Denda
--    4-201  Pendapatan Lain-lain
--
--  "security definer" = fungsi berjalan dengan hak pemilik (admin),
--  sehingga trigger boleh menulis ke tabel jurnal walaupun pengguna anon
--  hanya punya izin membaca jurnal.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. FUNGSI BANTU
-- ---------------------------------------------------------------------

-- Format angka jadi teks rupiah untuk pesan error. Contoh: 150000 -> 'Rp 150.000'
create or replace function rp(p_nilai numeric) returns text
language sql immutable as $$
  select 'Rp ' || replace(to_char(coalesce(p_nilai, 0), 'FM999,999,999,990'), ',', '.');
$$;


-- Membuat 1 jurnal (header) + 2 baris detail (debit & kredit) sekaligus.
-- Dipanggil oleh semua trigger di bawah. Jumlah debit = kredit, jadi
-- jurnal pasti seimbang (double-entry).
create or replace function buat_jurnal(
  p_tanggal     date,
  p_keterangan  text,
  p_sumber      text,
  p_sumber_id   bigint,
  p_akun_debit  text,
  p_akun_kredit text,
  p_jumlah      numeric
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  -- Tidak perlu jurnal kalau nilainya 0 (misal batal tanpa DP)
  if p_jumlah is null or p_jumlah <= 0 then
    return null;
  end if;

  insert into jurnal (tanggal, keterangan, sumber, sumber_id)
  values (p_tanggal, p_keterangan, p_sumber, p_sumber_id)
  returning id into v_id;

  -- Nomor bukti otomatis, contoh: JU-00012
  update jurnal set no_bukti = 'JU-' || lpad(v_id::text, 5, '0') where id = v_id;

  insert into jurnal_detail (jurnal_id, akun_kode, debit, kredit) values
    (v_id, p_akun_debit,  p_jumlah, 0),        -- baris DEBIT
    (v_id, p_akun_kredit, 0,        p_jumlah); -- baris KREDIT

  return v_id;
end;
$$;

-- buat_jurnal TIDAK boleh dipanggil langsung dari aplikasi (anon),
-- supaya orang tidak bisa membuat jurnal palsu. Hanya trigger yang memakainya.
revoke execute on function buat_jurnal(date, text, text, bigint, text, text, numeric)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. HITUNG TARIF (normal vs prime time)
--    Aturan Smash Padel Club:
--      - Jam operasional 07:00 - 23:00, booking per jam penuh
--      - Senin-Jumat 07:00-17:00  = tarif NORMAL
--      - Senin-Jumat 17:00-23:00  = tarif PRIME TIME
--      - Sabtu & Minggu seharian  = tarif PRIME TIME
--    Tarif dihitung PER JAM, jadi booking 16:00-18:00 di hari kerja
--    = 1 jam normal + 1 jam prime ("campuran").
--    Fungsi ini juga dipanggil frontend (supabase.rpc) untuk pratinjau harga.
-- ---------------------------------------------------------------------
create or replace function hitung_tarif(
  p_lapangan_id bigint,
  p_tanggal     date,
  p_jam_mulai   time,
  p_jam_selesai time
) returns table (durasi_jam int, jam_normal int, jam_prime int, total numeric, jenis_tarif text)
language plpgsql stable as $$
declare
  v_lap        lapangan%rowtype;
  v_weekend    boolean;
  v_jam_awal   int;
  v_jam_akhir  int;
  i            int;
begin
  select * into v_lap from lapangan where id = p_lapangan_id;
  if not found then
    raise exception 'Lapangan tidak ditemukan';
  end if;
  if not v_lap.aktif then
    raise exception 'Lapangan % sedang tidak aktif', v_lap.nama;
  end if;

  -- Validasi jam
  if p_jam_selesai <= p_jam_mulai then
    raise exception 'Jam selesai harus lebih besar dari jam mulai';
  end if;
  if extract(minute from p_jam_mulai) <> 0 or extract(minute from p_jam_selesai) <> 0 then
    raise exception 'Booking harus per jam penuh (contoh 08:00 - 10:00)';
  end if;
  if p_jam_mulai < time '07:00' or p_jam_selesai > time '23:00' then
    raise exception 'Jam operasional hanya 07:00 - 23:00';
  end if;

  -- extract(dow): 0 = Minggu, 6 = Sabtu
  v_weekend   := extract(dow from p_tanggal) in (0, 6);
  v_jam_awal  := extract(hour from p_jam_mulai)::int;
  v_jam_akhir := extract(hour from p_jam_selesai)::int;

  jam_normal := 0;
  jam_prime  := 0;

  -- Cek satu per satu setiap jam yang dipesan
  for i in v_jam_awal .. v_jam_akhir - 1 loop
    if v_weekend or i >= 17 then
      jam_prime := jam_prime + 1;
    else
      jam_normal := jam_normal + 1;
    end if;
  end loop;

  durasi_jam  := jam_normal + jam_prime;
  total       := jam_normal * v_lap.tarif_normal + jam_prime * v_lap.tarif_prime;
  jenis_tarif := case when jam_prime  = 0 then 'normal'
                      when jam_normal = 0 then 'prime'
                      else 'campuran' end;
  return next;
end;
$$;

-- Frontend (anon) boleh memanggil fungsi ini lewat supabase.rpc('hitung_tarif', ...)
grant execute on function hitung_tarif(bigint, date, time, time) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. BOOKING - SEBELUM INSERT
--    a) hitung durasi & tarif, b) CEK BENTROK jadwal,
--    c) kalau pakai paket member: cek sisa jam & masa berlaku
-- ---------------------------------------------------------------------
create or replace function trg_booking_sebelum_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tarif   record;
  v_paket   record;
  v_bentrok record;
begin
  -- a) Hitung tarif (sekaligus validasi jam)
  select * into v_tarif
  from hitung_tarif(new.lapangan_id, new.tanggal, new.jam_mulai, new.jam_selesai);
  new.durasi_jam := v_tarif.durasi_jam;

  -- b) Cek bentrok. Kunci per lapangan supaya 2 orang yang booking
  --    bersamaan tidak lolos dua-duanya.
  perform pg_advisory_xact_lock(new.lapangan_id);

  -- Dua jadwal bentrok jika: mulai_lama < selesai_baru DAN selesai_lama > mulai_baru
  select kode_booking, jam_mulai, jam_selesai into v_bentrok
  from booking
  where lapangan_id = new.lapangan_id
    and tanggal     = new.tanggal
    and status     <> 'batal'
    and jam_mulai   < new.jam_selesai
    and jam_selesai > new.jam_mulai
  limit 1;

  if found then
    raise exception 'Jadwal bentrok dengan booking % (% - %)',
      v_bentrok.kode_booking,
      to_char(v_bentrok.jam_mulai, 'HH24:MI'),
      to_char(v_bentrok.jam_selesai, 'HH24:MI');
  end if;

  -- c) Booking reguler vs booking pakai paket member
  if new.pembelian_paket_id is null then
    new.jenis_tarif := v_tarif.jenis_tarif;
    new.total_harga := v_tarif.total;
    new.status      := 'menunggu';          -- menunggu pembayaran DP
  else
    select * into v_paket from pembelian_paket where id = new.pembelian_paket_id for update;
    if not found then
      raise exception 'Paket member tidak ditemukan';
    end if;
    if v_paket.pelanggan_id <> new.pelanggan_id then
      raise exception 'Paket member ini bukan milik pelanggan tersebut';
    end if;
    if new.tanggal < v_paket.tanggal_beli or new.tanggal > v_paket.tanggal_kadaluarsa then
      raise exception 'Tanggal main di luar masa berlaku paket (s.d. %)',
        to_char(v_paket.tanggal_kadaluarsa, 'DD-MM-YYYY');
    end if;
    if v_paket.jam_total - v_paket.jam_terpakai < new.durasi_jam then
      raise exception 'Sisa jam paket tidak cukup (sisa % jam, dibutuhkan % jam)',
        v_paket.jam_total - v_paket.jam_terpakai, new.durasi_jam;
    end if;

    -- Nilai booking member = harga paket per jam x durasi.
    -- Nilai inilah yang nanti diakui sebagai pendapatan saat booking selesai.
    new.jenis_tarif := 'member';
    new.total_harga := round(v_paket.harga / v_paket.jam_total * new.durasi_jam, 2);
    new.status      := 'lunas';             -- sudah dibayar di muka lewat paket
  end if;

  -- Kode booking otomatis, contoh: BK-260926-0007
  new.kode_booking := 'BK-' || to_char(new.tanggal, 'YYMMDD') || '-' || lpad(new.id::text, 4, '0');
  new.created_at   := now();
  return new;
end;
$$;

create or replace trigger booking_sebelum_insert
before insert on booking
for each row execute function trg_booking_sebelum_insert();


-- ---------------------------------------------------------------------
-- 3. BOOKING - SESUDAH INSERT
--    Kalau pakai paket member, jam paket langsung dipotong (dicadangkan).
-- ---------------------------------------------------------------------
create or replace function trg_booking_sesudah_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pembelian_paket_id is not null then
    update pembelian_paket
       set jam_terpakai = jam_terpakai + new.durasi_jam
     where id = new.pembelian_paket_id;
  end if;
  return new;
end;
$$;

create or replace trigger booking_sesudah_insert
after insert on booking
for each row execute function trg_booking_sesudah_insert();


-- ---------------------------------------------------------------------
-- 4. BOOKING - SEBELUM UPDATE (penjaga alur status)
--    Alur yang diizinkan:
--      menunggu -> dp / lunas / batal
--      dp       -> lunas / batal
--      lunas    -> selesai / batal
--      selesai & batal = FINAL, tidak bisa diubah lagi
--    Jadwal & harga dikunci. Kalau mau ganti jadwal: batalkan, buat baru.
-- ---------------------------------------------------------------------
create or replace function trg_booking_sebelum_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dibayar numeric;
begin
  if old.status in ('selesai', 'batal') then
    raise exception 'Booking % sudah berstatus "%" dan tidak bisa diubah lagi',
      old.kode_booking, old.status;
  end if;

  if new.pelanggan_id <> old.pelanggan_id
     or new.lapangan_id <> old.lapangan_id
     or new.tanggal     <> old.tanggal
     or new.jam_mulai   <> old.jam_mulai
     or new.jam_selesai <> old.jam_selesai
     or new.total_harga <> old.total_harga
     or new.pembelian_paket_id is distinct from old.pembelian_paket_id then
    raise exception 'Jadwal/harga booking tidak boleh diubah. Batalkan lalu buat booking baru.';
  end if;

  -- Kolom otomatis dikembalikan ke nilai lama
  new.kode_booking := old.kode_booking;
  new.durasi_jam   := old.durasi_jam;
  new.jenis_tarif  := old.jenis_tarif;
  new.created_at   := old.created_at;

  if new.status = old.status then
    return new;   -- status tidak berubah (misal hanya ubah catatan)
  end if;

  if not (
       (old.status = 'menunggu' and new.status in ('dp', 'lunas', 'batal'))
    or (old.status = 'dp'       and new.status in ('lunas', 'batal'))
    or (old.status = 'lunas'    and new.status in ('selesai', 'batal'))
  ) then
    raise exception 'Status tidak bisa diubah dari "%" ke "%"', old.status, new.status;
  end if;

  -- Status DP/lunas harus sesuai uang yang benar-benar sudah diterima
  if new.status in ('dp', 'lunas') then
    select coalesce(sum(jumlah), 0) into v_dibayar from pembayaran where booking_id = new.id;
    if new.status = 'dp' and v_dibayar <= 0 then
      raise exception 'Status DP hanya bisa diperoleh lewat menu Pembayaran';
    end if;
    if new.status = 'lunas' and v_dibayar < new.total_harga then
      raise exception 'Booking belum lunas. Sisa tagihan %', rp(new.total_harga - v_dibayar);
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger booking_sebelum_update
before update on booking
for each row execute function trg_booking_sebelum_update();


-- ---------------------------------------------------------------------
-- 5. BOOKING - SESUDAH UPDATE (JURNAL OTOMATIS)
--    a) SELESAI dimainkan -> pendapatan diakui:
--         (D) Pendapatan Diterima di Muka  /  (K) Pendapatan Sewa Lapangan
--       Berlaku juga untuk booking member: pendapatan diakui per jam dipakai.
--    b) BATAL -> DP hangus jadi pendapatan lain-lain:
--         (D) Pendapatan Diterima di Muka  /  (K) Pendapatan Lain-lain
--       Kalau booking member batal: jam paket dikembalikan, tanpa jurnal.
-- ---------------------------------------------------------------------
create or replace function trg_booking_sesudah_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dibayar numeric;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'selesai' then
    perform buat_jurnal(
      new.tanggal,
      case when new.pembelian_paket_id is null
           then 'Pengakuan pendapatan sewa lapangan ' || new.kode_booking
           else 'Pengakuan pendapatan paket member (' || new.durasi_jam || ' jam) ' || new.kode_booking
      end,
      'booking', new.id,
      '2-101', '4-101', new.total_harga);

  elsif new.status = 'batal' then
    if new.pembelian_paket_id is not null then
      -- Kembalikan jam paket member yang tadinya dicadangkan
      update pembelian_paket
         set jam_terpakai = jam_terpakai - new.durasi_jam
       where id = new.pembelian_paket_id;
    else
      select coalesce(sum(jumlah), 0) into v_dibayar from pembayaran where booking_id = new.id;
      perform buat_jurnal(
        current_date,
        'DP hangus - pembatalan booking ' || new.kode_booking,
        'booking', new.id,
        '2-101', '4-201', v_dibayar);   -- kalau v_dibayar = 0, tidak ada jurnal
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger booking_sesudah_update
after update on booking
for each row execute function trg_booking_sesudah_update();


-- ---------------------------------------------------------------------
-- 6. PEMBAYARAN - SEBELUM INSERT (validasi)
--    - hanya untuk booking reguler berstatus menunggu / dp
--    - jumlah tidak boleh melebihi sisa tagihan
--    - jenis otomatis: 'pelunasan' kalau melunasi, selain itu 'dp'
-- ---------------------------------------------------------------------
create or replace function trg_pembayaran_sebelum_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_booking booking%rowtype;
  v_dibayar numeric;
  v_sisa    numeric;
begin
  select * into v_booking from booking where id = new.booking_id for update;
  if not found then
    raise exception 'Booking tidak ditemukan';
  end if;
  if v_booking.pembelian_paket_id is not null then
    raise exception 'Booking % memakai paket member, tidak perlu dibayar lagi', v_booking.kode_booking;
  end if;
  if v_booking.status not in ('menunggu', 'dp') then
    raise exception 'Booking % berstatus "%", tidak bisa menerima pembayaran',
      v_booking.kode_booking, v_booking.status;
  end if;

  select coalesce(sum(jumlah), 0) into v_dibayar from pembayaran where booking_id = new.booking_id;
  v_sisa := v_booking.total_harga - v_dibayar;

  if new.jumlah > v_sisa then
    raise exception 'Jumlah pembayaran melebihi sisa tagihan (%)', rp(v_sisa);
  end if;

  new.jenis := case when new.jumlah = v_sisa then 'pelunasan' else 'dp' end;
  return new;
end;
$$;

create or replace trigger pembayaran_sebelum_insert
before insert on pembayaran
for each row execute function trg_pembayaran_sebelum_insert();


-- ---------------------------------------------------------------------
-- 7. PEMBAYARAN - SESUDAH INSERT (JURNAL OTOMATIS)
--    Terima DP / pelunasan:
--      (D) Kas  /  (K) Pendapatan Diterima di Muka
--    Belum jadi pendapatan karena lapangan BELUM dipakai.
--    Lalu status booking diperbarui menjadi 'dp' atau 'lunas'.
-- ---------------------------------------------------------------------
create or replace function trg_pembayaran_sesudah_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_booking booking%rowtype;
  v_dibayar numeric;
begin
  select * into v_booking from booking where id = new.booking_id;

  perform buat_jurnal(
    new.tanggal,
    case when new.jenis = 'dp' then 'Penerimaan DP booking ' else 'Pelunasan booking ' end
      || v_booking.kode_booking || ' (' || new.metode_bayar || ')',
    'pembayaran', new.id,
    '1-101', '2-101', new.jumlah);

  select coalesce(sum(jumlah), 0) into v_dibayar from pembayaran where booking_id = new.booking_id;

  update booking
     set status = case when v_dibayar >= total_harga then 'lunas' else 'dp' end
   where id = new.booking_id;

  return new;
end;
$$;

create or replace trigger pembayaran_sesudah_insert
after insert on pembayaran
for each row execute function trg_pembayaran_sesudah_insert();


-- ---------------------------------------------------------------------
-- 8. PEMBELIAN PAKET - SEBELUM INSERT
--    Salin harga, jumlah jam & hitung tanggal kadaluarsa dari paket_member
--    (nilai dari aplikasi diabaikan supaya tidak bisa dimanipulasi).
-- ---------------------------------------------------------------------
create or replace function trg_pembelian_paket_sebelum_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_paket paket_member%rowtype;
begin
  select * into v_paket from paket_member where id = new.paket_id;
  if not found then
    raise exception 'Paket member tidak ditemukan';
  end if;
  if not v_paket.aktif then
    raise exception 'Paket % sudah tidak dijual', v_paket.nama_paket;
  end if;

  new.harga              := v_paket.harga;
  new.jam_total          := v_paket.jumlah_jam;
  new.jam_terpakai       := 0;
  new.tanggal_kadaluarsa := new.tanggal_beli + v_paket.masa_berlaku_hari;
  return new;
end;
$$;

create or replace trigger pembelian_paket_sebelum_insert
before insert on pembelian_paket
for each row execute function trg_pembelian_paket_sebelum_insert();


-- ---------------------------------------------------------------------
-- 9. PEMBELIAN PAKET - SESUDAH INSERT (JURNAL OTOMATIS)
--    Beli paket member:
--      (D) Kas  /  (K) Pendapatan Diterima di Muka
--    Pendapatan baru diakui per jam dipakai (lihat trigger no. 5).
-- ---------------------------------------------------------------------
create or replace function trg_pembelian_paket_sesudah_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nama_paket     text;
  v_nama_pelanggan text;
begin
  select nama_paket into v_nama_paket     from paket_member where id = new.paket_id;
  select nama       into v_nama_pelanggan from pelanggan    where id = new.pelanggan_id;

  perform buat_jurnal(
    new.tanggal_beli,
    'Penjualan ' || v_nama_paket || ' - ' || v_nama_pelanggan || ' (' || new.metode_bayar || ')',
    'pembelian_paket', new.id,
    '1-101', '2-101', new.harga);
  return new;
end;
$$;

create or replace trigger pembelian_paket_sesudah_insert
after insert on pembelian_paket
for each row execute function trg_pembelian_paket_sesudah_insert();


-- ---------------------------------------------------------------------
-- 10. SEWA PERALATAN - SEBELUM INSERT
--     Cek stok cukup, isi tarif & subtotal otomatis.
-- ---------------------------------------------------------------------
create or replace function trg_sewa_sebelum_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_alat          peralatan%rowtype;
  v_status_booking text;
begin
  select status into v_status_booking from booking where id = new.booking_id;
  if not found then
    raise exception 'Booking tidak ditemukan';
  end if;
  if v_status_booking = 'batal' then
    raise exception 'Tidak bisa menyewa peralatan untuk booking yang sudah batal';
  end if;

  -- "for update" mengunci baris peralatan agar stok tidak dipakai bersamaan
  select * into v_alat from peralatan where id = new.peralatan_id for update;
  if not found then
    raise exception 'Peralatan tidak ditemukan';
  end if;
  if v_alat.stok < new.jumlah then
    raise exception 'Stok % tidak cukup (tersedia %)', v_alat.nama, v_alat.stok;
  end if;

  new.tarif           := v_alat.tarif_sewa;
  new.subtotal        := v_alat.tarif_sewa * new.jumlah;
  new.status_kembali  := 'dipinjam';
  new.jumlah_rusak    := 0;
  new.denda           := 0;
  new.tanggal_kembali := null;
  return new;
end;
$$;

create or replace trigger sewa_sebelum_insert
before insert on sewa_peralatan
for each row execute function trg_sewa_sebelum_insert();


-- ---------------------------------------------------------------------
-- 11. SEWA PERALATAN - SESUDAH INSERT
--     Stok BERKURANG + JURNAL OTOMATIS:
--       (D) Kas  /  (K) Pendapatan Sewa Peralatan
-- ---------------------------------------------------------------------
create or replace function trg_sewa_sesudah_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nama_alat text;
  v_kode      text;
begin
  update peralatan set stok = stok - new.jumlah where id = new.peralatan_id
  returning nama into v_nama_alat;

  select kode_booking into v_kode from booking where id = new.booking_id;

  perform buat_jurnal(
    new.tanggal_sewa,
    'Sewa ' || new.jumlah || ' ' || v_nama_alat || ' - ' || v_kode,
    'sewa_peralatan', new.id,
    '1-101', '4-102', new.subtotal);
  return new;
end;
$$;

create or replace trigger sewa_sesudah_insert
after insert on sewa_peralatan
for each row execute function trg_sewa_sesudah_insert();


-- ---------------------------------------------------------------------
-- 12. SEWA PERALATAN - SEBELUM UPDATE (proses pengembalian)
--     Frontend cukup mengirim status_kembali ('dikembalikan' / 'rusak'),
--     jumlah_rusak, dan (opsional) denda. Jika denda 0 saat rusak,
--     denda dihitung otomatis = jumlah_rusak x denda_rusak per unit.
-- ---------------------------------------------------------------------
create or replace function trg_sewa_sebelum_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_denda_unit numeric;
begin
  if old.status_kembali <> 'dipinjam' then
    raise exception 'Peralatan ini sudah diproses pengembaliannya';
  end if;

  -- Data sewa tidak boleh diubah, hanya status pengembalian
  new.booking_id   := old.booking_id;
  new.peralatan_id := old.peralatan_id;
  new.jumlah       := old.jumlah;
  new.tarif        := old.tarif;
  new.subtotal     := old.subtotal;
  new.tanggal_sewa := old.tanggal_sewa;

  if new.status_kembali = 'dipinjam' then
    new.jumlah_rusak := 0;
    new.denda        := 0;
    return new;
  end if;

  new.tanggal_kembali := coalesce(new.tanggal_kembali, current_date);

  if new.status_kembali = 'dikembalikan' then
    new.jumlah_rusak := 0;
    new.denda        := 0;
  else  -- 'rusak'
    if new.jumlah_rusak < 1 or new.jumlah_rusak > old.jumlah then
      raise exception 'Jumlah rusak harus antara 1 dan %', old.jumlah;
    end if;
    if coalesce(new.denda, 0) = 0 then
      select denda_rusak into v_denda_unit from peralatan where id = old.peralatan_id;
      new.denda := new.jumlah_rusak * v_denda_unit;
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger sewa_sebelum_update
before update on sewa_peralatan
for each row execute function trg_sewa_sebelum_update();


-- ---------------------------------------------------------------------
-- 13. SEWA PERALATAN - SESUDAH UPDATE
--     Stok BERTAMBAH lagi sebanyak unit yang kembali dalam kondisi baik
--     (unit rusak tidak kembali ke stok).
--     Jika ada denda -> JURNAL OTOMATIS:
--       (D) Kas  /  (K) Pendapatan Denda
-- ---------------------------------------------------------------------
create or replace function trg_sewa_sesudah_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nama_alat text;
  v_kode      text;
begin
  if old.status_kembali = 'dipinjam' and new.status_kembali <> 'dipinjam' then
    update peralatan set stok = stok + (new.jumlah - new.jumlah_rusak)
     where id = new.peralatan_id
    returning nama into v_nama_alat;

    if new.denda > 0 then
      select kode_booking into v_kode from booking where id = new.booking_id;
      perform buat_jurnal(
        new.tanggal_kembali,
        'Denda kerusakan ' || new.jumlah_rusak || ' ' || v_nama_alat || ' - ' || v_kode,
        'sewa_peralatan', new.id,
        '1-101', '4-103', new.denda);
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger sewa_sesudah_update
after update on sewa_peralatan
for each row execute function trg_sewa_sesudah_update();
