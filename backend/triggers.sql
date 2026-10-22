-- =====================================================================
--  FUNGSI & TRIGGER (JURNAL OTOMATIS) - versi 2
--  Sistem Akuntansi Pendapatan Sewa Lapangan Padel - Smash Padel Club
-- ---------------------------------------------------------------------
--  Jalankan SETELAH schema.sql.
--
--  Apa itu TRIGGER? Fungsi yang otomatis dijalankan database setiap kali
--  ada INSERT / UPDATE pada tabel tertentu. Dengan trigger, jurnal
--  akuntansi selalu tercatat walaupun frontend lupa membuatnya.
--
--  Kode akun yang dipakai (lihat seed.sql):
--    1-101  Kas                          (penerimaan tunai)
--    1-102  Bank                         (penerimaan transfer)
--    1-103  Saldo QRIS                   (penerimaan QRIS, menunggu settlement)
--    2-101  Pendapatan Diterima di Muka  (kewajiban / utang jasa)
--    4-101  Pendapatan Sewa Lapangan
--    4-102  Pendapatan Sewa Peralatan
--    4-103  Pendapatan Denda
--    4-104  Pendapatan Paket Member Kedaluwarsa
--    4-201  Pendapatan Lain-lain         (DP hangus)
--    6-101  Beban MDR QRIS               (potongan penyedia QRIS saat settlement)
--
--  "security definer" = fungsi berjalan dengan hak pemilik (admin database),
--  sehingga trigger boleh menulis ke tabel jurnal walaupun pengguna aplikasi
--  hanya punya izin membaca jurnal.
--
--  auth.uid() = id pengguna yang sedang login. Bernilai NULL bila perintah
--  dijalankan dari SQL Editor (misal seed.sql) -> validasi khusus pengguna
--  aplikasi dilewati supaya data contoh bisa dibuat dengan tanggal lampau.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. FUNGSI BANTU
-- ---------------------------------------------------------------------

-- Format angka jadi teks rupiah untuk pesan error. Contoh: 150000 -> 'Rp 150.000'
create or replace function rp(p_nilai numeric) returns text
language sql immutable as $$
  select 'Rp ' || replace(to_char(coalesce(p_nilai, 0), 'FM999,999,999,990'), ',', '.');
$$;

-- Tanggal & waktu sekarang menurut WIB (server Supabase memakai UTC)
create or replace function hari_ini_wib() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Jakarta')::date;
$$;

create or replace function waktu_wib() returns timestamp
language sql stable as $$
  select now() at time zone 'Asia/Jakarta';
$$;

-- Akun kas sesuai metode pembayaran (dipisah agar bisa direkonsiliasi)
create or replace function akun_kas(p_metode text) returns text
language sql immutable as $$
  select case p_metode when 'transfer' then '1-102'
                       when 'qris'     then '1-103'
                       else '1-101' end;
$$;

-- Apakah bulan dari tanggal ini sudah ditutup (tutup buku)?
create or replace function periode_tertutup(p_tanggal date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tutup_buku where periode = date_trunc('month', p_tanggal)::date);
$$;

-- Tanggal untuk jurnal OTOMATIS yang terlambat (pengakuan pendapatan, breakage):
-- bila bulannya sudah ditutup, digeser ke tanggal 1 bulan berikutnya yang masih
-- terbuka, supaya laporan bulan yang sudah ditutup tidak berubah.
create or replace function tanggal_jurnal_terbuka(p_tanggal date) returns date
language plpgsql stable security definer set search_path = public as $$
declare
  v_tanggal date := p_tanggal;
begin
  while periode_tertutup(v_tanggal) loop
    v_tanggal := (date_trunc('month', v_tanggal) + interval '1 month')::date;
  end loop;
  return v_tanggal;
end;
$$;

-- Validasi tanggal transaksi yang diisi pengguna:
--   - tidak boleh jatuh di bulan yang sudah ditutup (berlaku untuk semua)
--   - tidak boleh di masa depan
--   - mundur lebih dari 3 hari hanya boleh oleh owner
create or replace function cek_tanggal_transaksi(p_tanggal date, p_label text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if periode_tertutup(p_tanggal) then
    raise exception 'Periode % sudah ditutup (tutup buku); tanggal % tidak bisa memakai bulan tersebut',
      to_char(p_tanggal, 'MM-YYYY'), p_label;
  end if;
  if auth.uid() is null then
    return;   -- dijalankan dari SQL Editor (data contoh)
  end if;
  if p_tanggal > hari_ini_wib() then
    raise exception 'Tanggal % tidak boleh di masa depan', p_label;
  end if;
  if p_tanggal < hari_ini_wib() - 3 and coalesce(peran_saya(), '') <> 'owner' then
    raise exception 'Tanggal % lebih dari 3 hari ke belakang hanya boleh dicatat oleh owner', p_label;
  end if;
end;
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

  -- Lapisan pengaman terakhir: tidak ada jurnal yang boleh masuk ke bulan
  -- yang sudah ditutup, dari jalur mana pun.
  if periode_tertutup(p_tanggal) then
    raise exception 'Periode % sudah ditutup (tutup buku); jurnal tidak bisa dicatat di bulan tersebut',
      to_char(p_tanggal, 'MM-YYYY');
  end if;

  insert into jurnal (tanggal, keterangan, sumber, sumber_id, dibuat_oleh)
  values (p_tanggal, p_keterangan, p_sumber, p_sumber_id, auth.uid())
  returning id into v_id;

  -- Nomor bukti otomatis, contoh: JU-00012
  update jurnal set no_bukti = 'JU-' || lpad(v_id::text, 5, '0') where id = v_id;

  insert into jurnal_detail (jurnal_id, akun_kode, debit, kredit) values
    (v_id, p_akun_debit,  p_jumlah, 0),        -- baris DEBIT
    (v_id, p_akun_kredit, 0,        p_jumlah); -- baris KREDIT

  return v_id;
end;
$$;

-- buat_jurnal & cek_tanggal_transaksi TIDAK boleh dipanggil langsung dari
-- aplikasi, supaya orang tidak bisa membuat jurnal palsu.
revoke execute on function buat_jurnal(date, text, text, bigint, text, text, numeric)
  from public, anon, authenticated;
revoke execute on function cek_tanggal_transaksi(date, text) from public, anon, authenticated;
revoke execute on function periode_tertutup(date)          from public, anon, authenticated;
revoke execute on function tanggal_jurnal_terbuka(date)    from public, anon, authenticated;


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

-- Hanya pengguna yang login yang boleh memanggil fungsi ini
revoke execute on function hitung_tarif(bigint, date, time, time) from public, anon;
grant  execute on function hitung_tarif(bigint, date, time, time) to authenticated;


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
  -- Pengguna aplikasi tidak boleh membuat booking untuk tanggal yang sudah lewat
  if auth.uid() is not null and new.tanggal < hari_ini_wib() then
    raise exception 'Tidak bisa membuat booking untuk tanggal yang sudah lewat';
  end if;

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

  -- Kolom pembatalan & audit diisi server, bukan dari aplikasi
  new.dibatalkan_oleh_klub := false;
  new.alasan_batal  := null;
  new.hasil_batal   := null;
  new.metode_refund := null;
  new.dibuat_oleh   := coalesce(auth.uid(), new.dibuat_oleh);
  new.diubah_oleh   := null;

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
--    Riwayat status dicatat.
-- ---------------------------------------------------------------------
create or replace function trg_booking_sesudah_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pembelian_paket_id is not null then
    update pembelian_paket
       set jam_terpakai = jam_terpakai + new.durasi_jam
     where id = new.pembelian_paket_id;
  end if;

  insert into riwayat_status_booking (booking_id, status_lama, status_baru, keterangan, oleh)
  values (new.id, null, new.status, 'Booking dibuat', auth.uid());
  return new;
end;
$$;

create or replace trigger booking_sesudah_insert
after insert on booking
for each row execute function trg_booking_sesudah_insert();


-- ---------------------------------------------------------------------
-- 4. BOOKING - SEBELUM UPDATE (penjaga alur status & kebijakan batal)
--    Alur yang diizinkan:
--      menunggu -> dp / lunas / batal
--      dp       -> lunas / batal
--      lunas    -> selesai / batal
--      selesai & batal = FINAL, tidak bisa diubah lagi
--    Jadwal & harga dikunci. Kalau mau ganti jadwal: batalkan, buat baru.
--
--    KEBIJAKAN PEMBATALAN (hasil_batal ditentukan server):
--      - Booking paket member / belum ada pembayaran -> 'tanpa_dana'
--      - Dibatalkan oleh KLUB, atau oleh pelanggan >= 24 jam sebelum
--        jam main                                      -> 'refund'
--      - Dibatalkan oleh pelanggan < 24 jam sebelum main -> 'hangus'
--    Refund (uang keluar) HANYA boleh dilakukan oleh owner.
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
  new.dibuat_oleh  := old.dibuat_oleh;
  new.hasil_batal  := old.hasil_batal;
  new.diubah_oleh  := coalesce(auth.uid(), new.diubah_oleh);

  if new.status = old.status then
    -- status tidak berubah (misal hanya ubah catatan); kolom batal tidak boleh diisi
    new.dibatalkan_oleh_klub := old.dibatalkan_oleh_klub;
    new.alasan_batal  := old.alasan_batal;
    new.metode_refund := old.metode_refund;
    return new;
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

  -- Pendapatan hanya boleh diakui setelah jam main dimulai
  if new.status = 'selesai' and auth.uid() is not null
     and (new.tanggal + new.jam_mulai) > waktu_wib() then
    raise exception 'Booking % belum dimainkan (jadwal % %)',
      new.kode_booking, to_char(new.tanggal, 'DD-MM-YYYY'), to_char(new.jam_mulai, 'HH24:MI');
  end if;

  -- Pembatalan: tentukan hasilnya sesuai kebijakan
  if new.status = 'batal' then
    select coalesce(sum(jumlah), 0) into v_dibayar from pembayaran where booking_id = new.id;

    if new.pembelian_paket_id is not null or v_dibayar = 0 then
      new.hasil_batal   := 'tanpa_dana';
      new.metode_refund := null;
    elsif coalesce(new.dibatalkan_oleh_klub, false)
          or (new.tanggal + new.jam_mulai) - waktu_wib() >= interval '24 hours' then
      new.hasil_batal   := 'refund';
      new.metode_refund := coalesce(new.metode_refund, 'tunai');
      if auth.uid() is not null and coalesce(peran_saya(), '') <> 'owner' then
        raise exception 'Pembatalan ini menghasilkan pengembalian dana (refund) % dan harus dilakukan oleh owner',
          rp(v_dibayar);
      end if;
    else
      new.hasil_batal   := 'hangus';
      new.metode_refund := null;
    end if;
  else
    new.dibatalkan_oleh_klub := old.dibatalkan_oleh_klub;
    new.alasan_batal  := old.alasan_batal;
    new.metode_refund := old.metode_refund;
  end if;

  return new;
end;
$$;

create or replace trigger booking_sebelum_update
before update on booking
for each row execute function trg_booking_sebelum_update();


-- ---------------------------------------------------------------------
-- 5. BOOKING - SESUDAH UPDATE (JURNAL OTOMATIS + RIWAYAT)
--    a) SELESAI dimainkan -> pendapatan diakui:
--         (D) Pendapatan Diterima di Muka  /  (K) Pendapatan Sewa Lapangan
--       Berlaku juga untuk booking member: pendapatan diakui per jam dipakai.
--    b) BATAL:
--         hangus -> (D) Pendapatan Diterima di Muka / (K) Pendapatan Lain-lain
--         refund -> (D) Pendapatan Diterima di Muka / (K) Kas / Bank / QRIS
--         booking member -> jam paket dikembalikan, tanpa jurnal
-- ---------------------------------------------------------------------
create or replace function trg_booking_sesudah_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dibayar    numeric;
  v_keterangan text;
  v_tgl_jurnal date;
begin
  if new.status = old.status then
    return new;
  end if;

  v_keterangan := case
    when new.status = 'selesai' then 'Sesi selesai dimainkan'
    when new.status = 'batal'   then 'Dibatalkan oleh ' ||
         case when new.dibatalkan_oleh_klub then 'klub' else 'pelanggan' end ||
         ' (' || new.hasil_batal || ')' || coalesce(': ' || new.alasan_batal, '')
    else 'Status pembayaran diperbarui' end;

  insert into riwayat_status_booking (booking_id, status_lama, status_baru, keterangan, oleh)
  values (new.id, old.status, new.status, v_keterangan, auth.uid());

  if new.status = 'selesai' then
    -- Biasanya bertanggal hari main; digeser bila bulannya sudah ditutup
    v_tgl_jurnal := tanggal_jurnal_terbuka(new.tanggal);
    perform buat_jurnal(
      v_tgl_jurnal,
      case when new.pembelian_paket_id is null
           then 'Pengakuan pendapatan sewa lapangan ' || new.kode_booking
           else 'Pengakuan pendapatan paket member (' || new.durasi_jam || ' jam) ' || new.kode_booking
      end || case when v_tgl_jurnal <> new.tanggal then ' (diakui terlambat)' else '' end,
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
      if new.hasil_batal = 'refund' then
        perform buat_jurnal(
          hari_ini_wib(),
          'Refund pembatalan booking ' || new.kode_booking || ' (' || new.metode_refund || ')',
          'booking', new.id,
          '2-101', akun_kas(new.metode_refund), v_dibayar);
      elsif new.hasil_batal = 'hangus' then
        perform buat_jurnal(
          hari_ini_wib(),
          'DP hangus - pembatalan booking ' || new.kode_booking,
          'booking', new.id,
          '2-101', '4-201', v_dibayar);
      end if;
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
--    - tanggal divalidasi (tidak di masa depan, maks. mundur 3 hari kecuali owner)
--    - jenis otomatis: 'pelunasan' kalau melunasi, selain itu 'dp'
-- ---------------------------------------------------------------------
create or replace function trg_pembayaran_sebelum_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_booking booking%rowtype;
  v_dibayar numeric;
  v_sisa    numeric;
begin
  perform cek_tanggal_transaksi(new.tanggal, 'pembayaran');

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

  new.jenis       := case when new.jumlah = v_sisa then 'pelunasan' else 'dp' end;
  new.dibuat_oleh := coalesce(auth.uid(), new.dibuat_oleh);
  return new;
end;
$$;

create or replace trigger pembayaran_sebelum_insert
before insert on pembayaran
for each row execute function trg_pembayaran_sebelum_insert();


-- ---------------------------------------------------------------------
-- 7. PEMBAYARAN - SESUDAH INSERT (JURNAL OTOMATIS)
--    Terima DP / pelunasan:
--      (D) Kas / Bank / QRIS (sesuai metode)  /  (K) Pendapatan Diterima di Muka
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
    akun_kas(new.metode_bayar), '2-101', new.jumlah);

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
  perform cek_tanggal_transaksi(new.tanggal_beli, 'pembelian paket');

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
  new.breakage_diakui    := false;
  new.nilai_breakage     := 0;
  new.dibuat_oleh        := coalesce(auth.uid(), new.dibuat_oleh);
  return new;
end;
$$;

create or replace trigger pembelian_paket_sebelum_insert
before insert on pembelian_paket
for each row execute function trg_pembelian_paket_sebelum_insert();


-- ---------------------------------------------------------------------
-- 9. PEMBELIAN PAKET - SESUDAH INSERT (JURNAL OTOMATIS)
--    Beli paket member:
--      (D) Kas / Bank / QRIS  /  (K) Pendapatan Diterima di Muka
--    Pendapatan baru diakui per jam dipakai (lihat trigger no. 5),
--    sisanya diakui saat paket kedaluwarsa (lihat fungsi no. 14).
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
    akun_kas(new.metode_bayar), '2-101', new.harga);
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
  v_alat           peralatan%rowtype;
  v_status_booking text;
begin
  perform cek_tanggal_transaksi(new.tanggal_sewa, 'sewa');

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

  new.tarif             := v_alat.tarif_sewa;
  new.subtotal          := v_alat.tarif_sewa * new.jumlah;
  new.status_kembali    := 'dipinjam';
  new.jumlah_rusak      := 0;
  new.denda             := 0;
  new.tanggal_kembali   := null;
  new.dikembalikan_oleh := null;
  new.dibuat_oleh       := coalesce(auth.uid(), new.dibuat_oleh);
  return new;
end;
$$;

create or replace trigger sewa_sebelum_insert
before insert on sewa_peralatan
for each row execute function trg_sewa_sebelum_insert();


-- ---------------------------------------------------------------------
-- 11. SEWA PERALATAN - SESUDAH INSERT
--     Stok BERKURANG + JURNAL OTOMATIS:
--       (D) Kas / Bank / QRIS  /  (K) Pendapatan Sewa Peralatan
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
    'Sewa ' || new.jumlah || ' ' || v_nama_alat || ' - ' || v_kode || ' (' || new.metode_bayar || ')',
    'sewa_peralatan', new.id,
    akun_kas(new.metode_bayar), '4-102', new.subtotal);
  return new;
end;
$$;

create or replace trigger sewa_sesudah_insert
after insert on sewa_peralatan
for each row execute function trg_sewa_sesudah_insert();


-- ---------------------------------------------------------------------
-- 12. SEWA PERALATAN - SEBELUM UPDATE (proses pengembalian)
--     Frontend cukup mengirim status_kembali ('dikembalikan' / 'rusak')
--     dan jumlah_rusak. DENDA SELALU DIHITUNG SERVER:
--       denda = jumlah_rusak x denda_rusak per unit
--     (nilai denda dari aplikasi diabaikan).
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
  new.metode_bayar := old.metode_bayar;
  new.tanggal_sewa := old.tanggal_sewa;
  new.dibuat_oleh  := old.dibuat_oleh;

  if new.status_kembali = 'dipinjam' then
    new.jumlah_rusak := 0;
    new.denda        := 0;
    return new;
  end if;

  -- Tanggal kembali: pengguna aplikasi -> hari ini (server); SQL Editor -> sesuai isian
  if auth.uid() is not null then
    new.tanggal_kembali := hari_ini_wib();
  else
    new.tanggal_kembali := coalesce(new.tanggal_kembali, current_date);
  end if;
  new.dikembalikan_oleh := coalesce(auth.uid(), new.dikembalikan_oleh);

  if new.status_kembali = 'dikembalikan' then
    new.jumlah_rusak := 0;
    new.denda        := 0;
  else  -- 'rusak'
    if new.jumlah_rusak < 1 or new.jumlah_rusak > old.jumlah then
      raise exception 'Jumlah rusak harus antara 1 dan %', old.jumlah;
    end if;
    select denda_rusak into v_denda_unit from peralatan where id = old.peralatan_id;
    new.denda := new.jumlah_rusak * v_denda_unit;
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
--       (D) Kas / Bank / QRIS  /  (K) Pendapatan Denda
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
        'Denda kerusakan ' || new.jumlah_rusak || ' ' || v_nama_alat || ' - ' || v_kode
          || ' (' || new.metode_bayar || ')',
        'sewa_peralatan', new.id,
        akun_kas(new.metode_bayar), '4-103', new.denda);
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger sewa_sesudah_update
after update on sewa_peralatan
for each row execute function trg_sewa_sesudah_update();


-- ---------------------------------------------------------------------
-- 14. PENGAKUAN SISA PAKET MEMBER KEDALUWARSA (breakage)
--     Paket yang sudah lewat masa berlaku dan masih punya sisa nilai:
--       (D) Pendapatan Diterima di Muka  /  (K) Pendapatan Paket Member Kedaluwarsa
--     Nilai = harga paket - nilai semua booking paket yang tidak batal
--     (booking yang belum diselesaikan tetap menunggu pengakuan biasa).
--     Dipanggil otomatis saat Dashboard dibuka; aman dipanggil berulang.
-- ---------------------------------------------------------------------
create or replace function akui_breakage_paket() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_paket   record;
  v_terpakai numeric;
  v_sisa     numeric;
  v_jumlah   int := 0;
  v_tgl      date;
begin
  if auth.uid() is not null and peran_saya() is null then
    raise exception 'Akses ditolak';
  end if;

  for v_paket in
    select pp.*, pm.nama_paket, p.nama as nama_pelanggan
    from pembelian_paket pp
    join paket_member pm on pm.id = pp.paket_id
    join pelanggan p on p.id = pp.pelanggan_id
    where pp.tanggal_kadaluarsa < hari_ini_wib() and not pp.breakage_diakui
    for update of pp
  loop
    select coalesce(sum(total_harga), 0) into v_terpakai
    from booking where pembelian_paket_id = v_paket.id and status <> 'batal';
    v_sisa := v_paket.harga - v_terpakai;

    if v_sisa > 0 then
      -- Bertanggal hari kedaluwarsa; digeser bila bulannya sudah ditutup
      v_tgl := tanggal_jurnal_terbuka(v_paket.tanggal_kadaluarsa);
      perform buat_jurnal(
        v_tgl,
        'Pengakuan sisa ' || v_paket.nama_paket || ' kedaluwarsa - ' || v_paket.nama_pelanggan
          || ' (' || (v_paket.jam_total - v_paket.jam_terpakai) || ' jam tidak terpakai)'
          || case when v_tgl <> v_paket.tanggal_kadaluarsa then ' (diakui terlambat)' else '' end,
        'pembelian_paket', v_paket.id,
        '2-101', '4-104', v_sisa);
      v_jumlah := v_jumlah + 1;
    end if;

    update pembelian_paket
       set breakage_diakui = true, nilai_breakage = greatest(v_sisa, 0)
     where id = v_paket.id;
  end loop;

  return v_jumlah;
end;
$$;

revoke execute on function akui_breakage_paket() from public, anon;
grant  execute on function akui_breakage_paket() to authenticated;


-- ---------------------------------------------------------------------
-- 15. SELESAIKAN BOOKING LEWAT WAKTU (aksi massal dari Dashboard)
--     Semua booking LUNAS yang jam mainnya sudah berakhir ditandai selesai
--     -> pendapatan diakui (lewat trigger no. 5) dan tercatat di riwayat.
--     "security invoker": berjalan dengan hak pengguna yang login (RLS berlaku).
-- ---------------------------------------------------------------------
create or replace function selesaikan_booking_lewat_waktu() returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_jumlah int;
begin
  if peran_saya() is null then
    raise exception 'Akses ditolak';
  end if;

  update booking set status = 'selesai'
   where status = 'lunas'
     and (tanggal + jam_selesai) <= waktu_wib();
  get diagnostics v_jumlah = row_count;
  return v_jumlah;
end;
$$;

revoke execute on function selesaikan_booking_lewat_waktu() from public, anon;
grant  execute on function selesaikan_booking_lewat_waktu() to authenticated;


-- ---------------------------------------------------------------------
-- 16. TUTUP BUKU (owner saja)
--     Menutup satu bulan yang SUDAH BERAKHIR. Setelah ditutup, tanggal di
--     bulan itu tidak bisa dipakai transaksi maupun jurnal (lihat
--     cek_tanggal_transaksi & buat_jurnal), sehingga laporannya final.
--     Syarat: semua booking di bulan itu sudah selesai / batal.
--     Sebelum menutup, sisa paket member yang kedaluwarsa diakui dulu.
-- ---------------------------------------------------------------------
create or replace function tutup_periode(p_periode date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_awal  date := date_trunc('month', p_periode)::date;
  v_akhir date := (date_trunc('month', p_periode) + interval '1 month' - interval '1 day')::date;
  v_sisa  int;
begin
  if auth.uid() is not null and coalesce(peran_saya(), '') <> 'owner' then
    raise exception 'Tutup buku hanya boleh dilakukan oleh owner';
  end if;
  if v_awal >= date_trunc('month', hari_ini_wib())::date then
    raise exception 'Hanya bulan yang sudah berakhir yang bisa ditutup';
  end if;
  if periode_tertutup(v_awal) then
    raise exception 'Periode % sudah ditutup', to_char(v_awal, 'MM-YYYY');
  end if;

  select count(*) into v_sisa
  from booking
  where tanggal between v_awal and v_akhir
    and status in ('menunggu', 'dp', 'lunas');
  if v_sisa > 0 then
    raise exception 'Masih ada % booking pada % yang belum dituntaskan (selesaikan atau batalkan dulu)',
      v_sisa, to_char(v_awal, 'MM-YYYY');
  end if;

  perform akui_breakage_paket();

  insert into tutup_buku (periode, ditutup_oleh) values (v_awal, auth.uid());
  insert into riwayat_tutup_buku (periode, aksi, oleh) values (v_awal, 'tutup', auth.uid());
  return to_char(v_awal, 'MM-YYYY');
end;
$$;


-- ---------------------------------------------------------------------
-- 17. BUKA KEMBALI PERIODE (owner saja, wajib alasan, tercatat di riwayat)
-- ---------------------------------------------------------------------
create or replace function buka_periode(p_periode date, p_alasan text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_awal date := date_trunc('month', p_periode)::date;
begin
  if auth.uid() is not null and coalesce(peran_saya(), '') <> 'owner' then
    raise exception 'Membuka kembali periode hanya boleh dilakukan oleh owner';
  end if;
  if length(trim(coalesce(p_alasan, ''))) < 5 then
    raise exception 'Alasan membuka kembali periode wajib diisi (minimal 5 karakter)';
  end if;
  if not periode_tertutup(v_awal) then
    raise exception 'Periode % belum ditutup', to_char(v_awal, 'MM-YYYY');
  end if;

  delete from tutup_buku where periode = v_awal;
  insert into riwayat_tutup_buku (periode, aksi, alasan, oleh)
  values (v_awal, 'buka', trim(p_alasan), auth.uid());
  return to_char(v_awal, 'MM-YYYY');
end;
$$;

revoke execute on function tutup_periode(date)       from public, anon;
revoke execute on function buka_periode(date, text)  from public, anon;
grant  execute on function tutup_periode(date)       to authenticated;
grant  execute on function buka_periode(date, text)  to authenticated;


-- ---------------------------------------------------------------------
-- 18. SETTLEMENT QRIS - SEBELUM INSERT (validasi, owner saja)
--     Angka dari laporan settlement penyedia QRIS:
--       jumlah_bruto  = total pembayaran QRIS yang dicairkan
--       jumlah_bersih = uang yang benar-benar masuk ke rekening Bank
--     biaya_mdr dihitung server = bruto - bersih (isian aplikasi diabaikan).
--     Bruto tidak boleh melebihi Saldo QRIS yang belum cair.
-- ---------------------------------------------------------------------
create or replace function trg_settlement_sebelum_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_saldo numeric;
begin
  if auth.uid() is not null and coalesce(peran_saya(), '') <> 'owner' then
    raise exception 'Settlement QRIS hanya boleh dicatat oleh owner';
  end if;
  perform cek_tanggal_transaksi(new.tanggal, 'settlement');

  new.no_referensi := trim(coalesce(new.no_referensi, ''));
  if new.no_referensi = '' then
    raise exception 'Nomor referensi laporan settlement wajib diisi';
  end if;
  -- Pesan jelas sebelum aturan UNIQUE / CHECK di tabel (yang tetap jadi lapisan cadangan)
  if exists (select 1 from settlement_qris where no_referensi = new.no_referensi) then
    raise exception 'Settlement dengan nomor referensi % sudah pernah dicatat', new.no_referensi;
  end if;
  if new.jumlah_bersih > new.jumlah_bruto then
    raise exception 'Jumlah masuk Bank (%) tidak boleh lebih besar dari jumlah kotor (%)',
      rp(new.jumlah_bersih), rp(new.jumlah_bruto);
  end if;

  -- Kunci supaya dua settlement bersamaan tidak sama-sama lolos cek saldo
  perform pg_advisory_xact_lock(103);
  select coalesce(sum(debit - kredit), 0) into v_saldo from jurnal_detail where akun_kode = '1-103';
  if new.jumlah_bruto > v_saldo then
    raise exception 'Jumlah kotor % melebihi Saldo QRIS yang belum cair (%)', rp(new.jumlah_bruto), rp(v_saldo);
  end if;

  new.biaya_mdr   := new.jumlah_bruto - new.jumlah_bersih;
  new.dibuat_oleh := coalesce(auth.uid(), new.dibuat_oleh);
  new.created_at  := now();
  return new;
end;
$$;

create or replace trigger settlement_sebelum_insert
before insert on settlement_qris
for each row execute function trg_settlement_sebelum_insert();


-- ---------------------------------------------------------------------
-- 19. SETTLEMENT QRIS - SESUDAH INSERT (JURNAL OTOMATIS, 2 jurnal)
--       (D) Bank            / (K) Saldo QRIS   sebesar jumlah bersih
--       (D) Beban MDR QRIS  / (K) Saldo QRIS   sebesar biaya MDR (jika > 0)
--     Total kredit Saldo QRIS = jumlah bruto.
-- ---------------------------------------------------------------------
create or replace function trg_settlement_sesudah_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform buat_jurnal(new.tanggal, 'Settlement QRIS ke Bank - ' || new.no_referensi,
    'settlement_qris', new.id, '1-102', '1-103', new.jumlah_bersih);
  perform buat_jurnal(new.tanggal, 'Biaya MDR QRIS - ' || new.no_referensi,
    'settlement_qris', new.id, '6-101', '1-103', new.biaya_mdr);
  return new;
end;
$$;

create or replace trigger settlement_sesudah_insert
after insert on settlement_qris
for each row execute function trg_settlement_sesudah_insert();
