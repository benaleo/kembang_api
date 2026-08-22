import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const myProfile = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const profileSchema = z.object({
  user_id: z.string(),
  email: z.string().nullable(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
});

const updateProfileBodySchema = z.object({
  full_name: z.string().min(1),
  phone: z.string().nullable().optional(),
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

// PATCH - Update current user's profile and sync customers data
myProfile.openapi(
  createRoute({
    method: 'patch',
    path: '/',
    tags: ['Profile'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateProfileBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated user profile',
        content: { 'application/json': { schema: profileSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    try {
      const userId = c.get('userId');
      const supabase = c.get('supabase');
      const { full_name, phone } = c.req.valid('json');
      const normalizedPhone = phone?.trim() ? phone.trim() : null;
      const normalizedFullName = full_name.trim();

      const { data, error } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          full_name: normalizedFullName,
          phone: normalizedPhone,
        },
      });

      if (error || !data.user) {
        return c.json({ error: error?.message || 'Failed to update user' }, 500);
      }

      const { data: existingCustomer, error: customerLookupError } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (customerLookupError) {
        return c.json({ error: customerLookupError.message }, 500);
      }

      const customer = existingCustomer as { id: number } | null;

      if (customer?.id) {
        const { error: updateCustomerError } = await (supabase.from('customers') as any)
          .update({ name: normalizedFullName, phone: normalizedPhone })
          .eq('id', customer.id);

        if (updateCustomerError) {
          return c.json({ error: updateCustomerError.message }, 500);
        }
      } else {
        const { error: insertCustomerError } = await (supabase.from('customers') as any).insert([
          {
            user_id: userId,
            name: normalizedFullName,
            phone: normalizedPhone,
          },
        ]);

        if (insertCustomerError) {
          return c.json({ error: insertCustomerError.message }, 500);
        }
      }

      const user = data.user;

      return c.json({
        user_id: user.id,
        email: user.email ?? null,
        full_name: (user.user_metadata?.full_name as string) ?? null,
        phone: (user.user_metadata?.phone as string) ?? null,
      });
    } catch (error) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  }
);

export default myProfile;
