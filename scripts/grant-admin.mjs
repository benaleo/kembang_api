#!/usr/bin/env node
/**
 * Tandai user sebagai admin lewat app_metadata.role.
 *
 * WAJIB dijalankan untuk semua akun CMS yang ada SEBELUM deploy perubahan
 * requireAdmin — kalau tidak, semua orang kehilangan akses CMS (403).
 *
 * app_metadata dipilih karena hanya bisa ditulis pakai service role key;
 * user tidak bisa mengubahnya sendiri lewat updateUser(), jadi tidak ada
 * jalur privilege escalation.
 *
 * Pemakaian:
 *   node scripts/grant-admin.mjs --list
 *   node scripts/grant-admin.mjs admin@contoh.com [email-lain@contoh.com ...]
 *   node scripts/grant-admin.mjs --revoke user@contoh.com
 *
 * Env (ambil dari .dev.vars atau environment):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function loadDevVars() {
  try {
    const raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key] && value) process.env[key] = value;
    }
  } catch {
    // .dev.vars tidak ada — andalkan environment
  }
}

loadDevVars();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Error: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib di-set.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

/** Ambil semua user (paginasi, karena listUsers dibatasi per halaman). */
async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function setRole(users, email, role) {
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`  SKIP  ${email} — user tidak ditemukan`);
    return false;
  }

  const nextMetadata = { ...(user.app_metadata || {}) };
  if (role) nextMetadata.role = role;
  else delete nextMetadata.role;

  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: nextMetadata,
  });

  if (error) {
    console.error(`  FAIL  ${email} — ${error.message}`);
    return false;
  }

  console.log(`  OK    ${email} -> role=${role ?? '(dihapus)'}`);
  return true;
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`Pemakaian:
  node scripts/grant-admin.mjs --list                    Tampilkan semua user + role
  node scripts/grant-admin.mjs <email> [email...]        Jadikan admin
  node scripts/grant-admin.mjs --revoke <email> [...]    Cabut status admin`);
  process.exit(0);
}

const users = await listAllUsers();

if (args.includes('--list')) {
  console.log(`Total ${users.length} user:\n`);
  for (const u of users) {
    const role = u.app_metadata?.role || 'user';
    console.log(`  ${role === 'admin' ? '[ADMIN]' : '       '} ${u.email || '(no email)'}  ${u.id}`);
  }
  process.exit(0);
}

const revoke = args.includes('--revoke');
const emails = args.filter((a) => !a.startsWith('--'));

if (emails.length === 0) {
  console.error('Error: tidak ada email yang diberikan.');
  process.exit(1);
}

console.log(revoke ? 'Mencabut status admin:' : 'Memberikan status admin:');

let failed = 0;
for (const email of emails) {
  const ok = await setRole(users, email, revoke ? null : 'admin');
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} dari ${emails.length} gagal.`);
  process.exit(1);
}

console.log('\nSelesai.');
