import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const auth = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
        content: { 'application/json': { schema: credentialsSchema } },
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
    const { email, password } = c.req.valid('json');

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return c.json({ error: error.message }, 400);
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
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
    },
  }),
  (c) => c.json({ success: true }),
);

export default auth;
