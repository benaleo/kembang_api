import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { safeEqual } from '../lib/safe-compare';

/**
 * Ambil role dari user Supabase.
 *
 * Sumber kebenaran: `app_metadata.role`. Field ini HANYA bisa ditulis pakai
 * service role key (lewat auth.admin.updateUserById) — user tidak bisa
 * mengubahnya sendiri lewat updateUser(), jadi aman dari privilege escalation.
 *
 * `user_metadata` TIDAK dipakai karena user bisa menulisnya sendiri.
 */
function resolveRole(user: any): string {
  const role = user?.app_metadata?.role;
  return typeof role === 'string' && role.length > 0 ? role : 'user';
}

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  // Self-call internal (AI tools memanggil route admin lewat HTTP).
  // Token dibaca dari secret — kalau secret belum di-set, jalur ini mati total
  // (fail closed) supaya tidak ada bypass default.
  const internalToken = c.req.header('X-Internal-Token');
  const expectedInternal = c.env.INTERNAL_API_TOKEN;
  if (internalToken) {
    if (expectedInternal && safeEqual(internalToken, expectedInternal)) {
      c.set('userId', 'internal');
      c.set('userRole', 'admin');
      c.set('isInternal', true);
      await next();
      return;
    }
    // Token internal dikirim tapi salah/tidak dikonfigurasi — tolak, jangan
    // fallback ke Authorization header biar percobaan brute force jelas gagal.
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const supabase = c.get('supabase');
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId', data.user.id);
  c.set('userRole', resolveRole(data.user));
  c.set('isInternal', false);
  await next();
}

/**
 * Authorization guard untuk route admin.
 *
 * WAJIB dipasang SETELAH requireAuth — middleware ini hanya membaca `userRole`
 * yang sudah di-resolve di sana. Tanpa ini, semua endpoint /admin/* cuma
 * ter-autentikasi (siapa kamu) tapi tidak ter-otorisasi (boleh apa) — dan
 * karena CMS dan storefront pakai endpoint login yang sama, customer biasa
 * bisa tembus ke data admin.
 */
export async function requireAdmin(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  if (c.get('userRole') !== 'admin') {
    return c.json({ error: 'Forbidden: admin access required' }, 403);
  }
  await next();
}
