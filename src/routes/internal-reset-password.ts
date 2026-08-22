import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const internalResetPassword = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const resetPasswordBodySchema = z.object({
  email: z.string().email(),
  new_password: z.string().min(6),
});

const errorResponse = z.object({ error: z.string() });

internalResetPassword.openapi(
  createRoute({
    method: 'post',
    path: '/reset-password',
    tags: ['Internal'],
    request: {
      body: {
        content: { 'application/json': { schema: resetPasswordBodySchema } },
      },
    },
    responses: {
      200: {
        description: 'Password reset successfully',
        content: { 'application/json': { schema: z.object({ success: z.boolean(), user_id: z.string() }) } },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponse } } },
      404: { description: 'User not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const internalToken = c.req.header('X-Internal-Token');
    if (internalToken !== 'kembang-internal') {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const supabase = c.get('supabase');
    const { email, new_password: newPassword } = c.req.valid('json');
    const normalizedEmail = email.trim().toLowerCase();

    const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      return c.json({ error: listError.message }, 500);
    }

    const user = listData.users.find((item: { id: string; email?: string | null }) => {
      return item.email?.toLowerCase() === normalizedEmail;
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      return c.json({ error: updateError.message }, 500);
    }

    return c.json({ success: true, user_id: user.id }, 200);
  },
);

export default internalResetPassword;
