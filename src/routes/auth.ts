import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const auth = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = credentialsSchema.extend({
  full_name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  redirect_to: z.string().url().optional(),
});

const verifyEmailSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(['signup', 'email_change', 'recovery']),
});

const resetPasswordSchema = z.object({
  token_hash: z.string().min(1),
  password: z.string().min(8),
});

const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
});

const authResponseSchema = z.object({
  user: z.any().nullable(),
  session: z
    .object({
      access_token: z.string(),
      refresh_token: z.string().nullable().optional(),
      expires_at: z.number().nullable().optional(),
      expires_in: z.number().nullable().optional(),
      token_type: z.string().nullable().optional(),
    })
    .nullable(),
});

const errorResponse = z.object({ error: z.string() });

const successResponse = z.object({ success: z.boolean() });

auth.openapi(
  createRoute({
    method: 'post',
    path: '/login',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: credentialsSchema } },
      },
    },
    responses: {
      200: {
        description: 'Authenticated Supabase session',
        content: { 'application/json': { schema: authResponseSchema } },
      },
      400: { description: 'Invalid request', content: { 'application/json': { schema: errorResponse } } },
      401: { description: 'Invalid credentials', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { email, password } = c.req.valid('json');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return c.json({ error: error.message }, 401);
    }

    return c.json({ user: data.user, session: data.session }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/register',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: registerSchema } },
      },
    },
    responses: {
      200: {
        description: 'Registered Supabase user/session',
        content: { 'application/json': { schema: authResponseSchema } },
      },
      400: { description: 'Registration failed', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { email, password, full_name, phone } = c.req.valid('json');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          ...(full_name ? { full_name } : {}),
          ...(phone ? { phone } : {}),
        },
      },
    });

    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ user: data.user, session: data.session }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/forgot-password',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: forgotPasswordSchema } },
      },
    },
    responses: {
      200: {
        description: 'Password reset email requested',
        content: { 'application/json': { schema: successResponse } },
      },
      400: { description: 'Reset request failed', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { email, redirect_to } = c.req.valid('json');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirect_to,
    });

    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ success: true }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/verify-email',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: verifyEmailSchema } },
      },
    },
    responses: {
      200: {
        description: 'Verified email or recovery token',
        content: { 'application/json': { schema: authResponseSchema } },
      },
      400: { description: 'Invalid or expired link', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { token_hash, type } = c.req.valid('json');

    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type });

    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ user: data.user, session: data.session }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/reset-password',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: resetPasswordSchema } },
      },
    },
    responses: {
      200: {
        description: 'Password reset completed',
        content: { 'application/json': { schema: successResponse } },
      },
      400: { description: 'Invalid or expired link', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { token_hash, password } = c.req.valid('json');

    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' });

    if (error || !data.user) {
      return c.json({ error: error?.message || 'Invalid or expired link' }, 400);
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(data.user.id, { password });

    if (updateError) {
      return c.json({ error: updateError.message }, 400);
    }

    return c.json({ success: true }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/refresh',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: refreshTokenSchema } },
      },
    },
    responses: {
      200: {
        description: 'Refreshed Supabase session',
        content: { 'application/json': { schema: authResponseSchema } },
      },
      400: { description: 'Invalid request', content: { 'application/json': { schema: errorResponse } } },
      401: { description: 'Invalid or expired refresh token', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { refresh_token } = c.req.valid('json');

    const { data, error } = await supabase.auth.refreshSession({ refresh_token });

    if (error || !data.session) {
      return c.json({ error: error?.message || 'Invalid or expired refresh token' }, 401);
    }

    return c.json({ user: data.user, session: data.session }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/logout',
    tags: ['Auth'],
    responses: {
      200: {
        description: 'Client can clear local auth session',
        content: { 'application/json': { schema: successResponse } },
      },
    },
  }),
  (c) => c.json({ success: true }),
);

export default auth;
