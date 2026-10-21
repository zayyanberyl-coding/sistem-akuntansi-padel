-- =====================================================================
--  TIRUAN LINGKUNGAN SUPABASE (khusus pengujian, BUKAN untuk Supabase)
-- ---------------------------------------------------------------------
--  Database uji (PGlite) adalah PostgreSQL biasa, jadi beberapa hal yang
--  di Supabase sudah tersedia perlu dibuat dulu:
--    - peran (role) anon & authenticated
--    - schema auth, tabel auth.users, fungsi auth.uid()
--    - hak bawaan Supabase: anon & authenticated otomatis mendapat akses
--      ke tabel baru di schema public. Hak bawaan ini sengaja ditiru
--      supaya uji membuktikan bahwa schema.sql benar-benar MENCABUT
--      akses anon (bukan sekadar karena hak tidak pernah diberikan).
--
--  auth.uid() membaca setting 'request.jwt.claim.sub', sama seperti di
--  Supabase. Penjalan uji mengisi setting ini untuk "login" sebagai
--  owner / admin / akun tanpa peran.
-- =====================================================================

create role anon nologin;
create role authenticated nologin;

create schema auth;
grant usage on schema auth to anon, authenticated;

create table auth.users (
  id     uuid primary key,
  email  text unique
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Hak bawaan Supabase untuk schema public
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- Akun login uji (padanan menu Authentication > Users)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@smashpadel.test'),
  ('00000000-0000-0000-0000-000000000002', 'admin@smashpadel.test'),
  ('00000000-0000-0000-0000-000000000003', 'tanpa-peran@smashpadel.test');
