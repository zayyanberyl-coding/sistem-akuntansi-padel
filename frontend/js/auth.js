/* ==================================================================
   AUTH - LOGIN, LOGOUT & PERAN PENGGUNA
   - Login memakai Supabase Auth (email + password).
   - Setelah login, peran diambil dari tabel "pengguna" (owner / admin).
   - Akun login yang belum diberi peran tidak bisa melihat data apa pun
     (dijaga RLS di database, bukan hanya di tampilan).
   - Body diberi class "peran-owner" / "peran-admin" supaya elemen
     berclass "khusus-owner" bisa disembunyikan untuk admin.
   ================================================================== */

let penggunaAktif = null;   // { id, nama, peran } setelah login berhasil

async function mulaiAplikasi() {
  $('form-login').addEventListener('submit', prosesLogin);
  $('tombol-keluar').addEventListener('click', keluar);

  // Jika sesi berakhir / logout di tab lain -> kembali ke layar login
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.reload();
  });

  const { data: { session } } = await db.auth.getSession();
  if (session) await masukKeAplikasi(session.user);
  else tampilkanLogin();
}

function tampilkanLogin(pesan) {
  document.body.classList.add('belum-login');
  $('layar-login').hidden = false;
  const el = $('login-error');
  el.hidden = !pesan;
  el.textContent = pesan || '';
  $('login-email').focus();
}

async function prosesLogin(e) {
  e.preventDefault();
  const selesai = mulaiMemuat(e);
  const { data, error } = await db.auth.signInWithPassword({
    email: $('login-email').value.trim(),
    password: $('login-password').value
  });
  selesai(!!error);
  if (error) {
    tampilkanLogin(error.message === 'Invalid login credentials'
      ? 'Email atau password salah.' : error.message);
    return;
  }
  $('login-password').value = '';
  await masukKeAplikasi(data.user);
}

// Ambil peran dari tabel pengguna, lalu tampilkan aplikasi
async function masukKeAplikasi(user) {
  const { data: profil, error } = await db.from('pengguna').select('id, nama, peran').eq('id', user.id).maybeSingle();
  if (error || !profil) {
    await db.auth.signOut({ scope: 'local' });
    tampilkanLogin('Akun ini belum diberi peran oleh owner. Hubungi owner untuk mendapatkan akses.');
    return;
  }

  penggunaAktif = profil;
  document.body.classList.remove('belum-login', 'peran-owner', 'peran-admin');
  document.body.classList.add('peran-' + profil.peran);
  $('layar-login').hidden = true;

  $('pengguna-nama').textContent = profil.nama;
  $('pengguna-peran').textContent = profil.peran === 'owner' ? 'Owner' : 'Admin';
  $('pengguna-inisial').textContent = profil.nama.split(' ').map(k => k[0]).slice(0, 2).join('').toUpperCase();

  bukaHalaman(location.hash.slice(1) || 'dashboard');
}

async function keluar() {
  await db.auth.signOut();
  location.hash = '';
  location.reload();
}

// true jika pengguna aktif adalah owner (untuk tampilan saja; aturan dijaga database)
function adalahOwner() {
  return penggunaAktif?.peran === 'owner';
}
