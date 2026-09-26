/* ==================================================================
   KONEKSI KE SUPABASE
   ------------------------------------------------------------------
   Ambil nilai di Supabase Dashboard > Project Settings > API:
     - Project URL           -> SUPABASE_URL
     - anon / public key     -> SUPABASE_ANON_KEY
       (di project baru namanya "Publishable key", diawali sb_publishable_)

   ⚠ JANGAN PERNAH menaruh "service_role" / "secret" key di sini!
     Key itu bisa melewati semua aturan keamanan (RLS) dan file ini
     akan ter-upload ke GitHub sehingga bisa dilihat siapa saja.
     Anon key memang dirancang untuk publik; keamanannya dijaga oleh
     RLS & trigger di database (lihat backend/schema.sql).
   ================================================================== */

const SUPABASE_URL = 'https://aiuiuezndapdqhxuvuax.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yhJBxs-3SEay095utaDkxg_xkssnwaE';

// true kalau URL & key sudah diganti dari contoh di atas
const supabaseSudahDiatur =
  !SUPABASE_URL.includes('XXXXXXXX') && !SUPABASE_ANON_KEY.startsWith('ISI_');

// Pengaman: tolak kalau yang ditempel ternyata service_role / secret key
(function cegahServiceRoleKey(key) {
  let berbahaya = key.startsWith('sb_secret_');
  try {
    // Key lama berbentuk JWT: header.payload.signature -> baca bagian "role"
    const payload = JSON.parse(atob(key.split('.')[1]));
    if (payload.role === 'service_role') berbahaya = true;
  } catch (e) {
    // bukan JWT, abaikan
  }
  if (berbahaya) {
    alert('BAHAYA: yang kamu isi adalah service_role/secret key. Ganti dengan anon (publishable) key!');
    throw new Error('service_role key tidak boleh dipakai di frontend');
  }
})(SUPABASE_ANON_KEY);

// "db" adalah objek client yang dipakai semua file JS lain untuk query.
// window.supabase berasal dari library supabase-js yang dimuat lewat CDN di index.html
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
