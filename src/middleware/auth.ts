import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
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
  await next();
}
