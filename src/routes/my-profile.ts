import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const myProfile = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const profileSchema = z.object({
  user_id: z.string(),
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
});

// GET - Current user's profile (from auth.users via Supabase Auth API)
myProfile.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Profile'],
    responses: {
      200: {
        description: 'Current user profile',
        content: { 'application/json': { schema: profileSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    const { data, error } = await supabase.auth.admin.getUserById(userId);

    if (error || !data.user) {
      return c.json({ error: 'User not found' }, 401);
    }

    const user = data.user;

    return c.json({
      user_id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.full_name as string) ?? null,
      phone: (user.user_metadata?.phone as string) ?? null,
    });
  }
);

export default myProfile;
