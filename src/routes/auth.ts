import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
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

const oauthStartSchema = z.object({
  redirect_to: z.string().url(),
});

const oauthSessionSchema = z.object({
  ticket: z.string().min(1),
});

const oauthUrlResponseSchema = z.object({
  url: z.string().url(),
});

const OAUTH_REDIRECT_COOKIE = 'kembang_oauth_redirect';
const OAUTH_HANDOFF_COOKIE = 'kembang_oauth_handoff';
const OAUTH_TICKET_COOKIE = 'kembang_oauth_ticket';
const OAUTH_SESSION_COOKIE_PREFIX = 'kembang_oauth_session_';
const OAUTH_STORAGE_COOKIE_PREFIX = 'kembang_oauth_storage_';
const OAUTH_HANDOFF_KV_PREFIX = 'oauth_handoff:';
const OAUTH_SESSION_KV_PREFIX = 'oauth_session:';
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

type OAuthHandoff = {
  redirect_to: string;
  storage: Record<string, string>;
};

type OAuthSessionPayload = {
  user: unknown;
  session: unknown;
};

const allowedOAuthRedirectOrigins = new Set([
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://kembang.langganan-ku.my.id',
]);

function isAllowedOAuthRedirect(redirectTo: string): boolean {
  try {
    const url = new URL(redirectTo);
    return allowedOAuthRedirectOrigins.has(url.origin) && url.pathname === '/auth/callback';
  } catch {
    return false;
  }
}

function createRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeCookieValue(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCookieValue(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

function getCookieDomain(c: Context<{ Bindings: Bindings; Variables: Variables }>): string | undefined {
  const hostname = new URL(c.req.url).hostname;
  return hostname.endsWith('.langganan-ku.my.id') ? '.langganan-ku.my.id' : undefined;
}

function oauthCookieOptions(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE,
    domain: getCookieDomain(c),
  };
}

function deleteOAuthCookie(c: Context<{ Bindings: Bindings; Variables: Variables }>, name: string) {
  deleteCookie(c, name, {
    path: '/',
    domain: getCookieDomain(c),
  });
}

function oauthStorageCookieName(key: string): string {
  return `${OAUTH_STORAGE_COOKIE_PREFIX}${encodeCookieValue(key)}`;
}

function createOAuthStorage(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  backingStorage: Record<string, string> = {},
) {
  return {
    getItem(key: string) {
      if (backingStorage[key]) {
        return backingStorage[key];
      }

      const encoded = getCookie(c, oauthStorageCookieName(key));
      return encoded ? decodeCookieValue(encoded) : null;
    },
    setItem(key: string, value: string) {
      backingStorage[key] = value;
      setCookie(c, oauthStorageCookieName(key), encodeCookieValue(value), oauthCookieOptions(c));
    },
    removeItem(key: string) {
      delete backingStorage[key];
      deleteOAuthCookie(c, oauthStorageCookieName(key));
    },
  };
}

function createOAuthSupabaseClient(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  backingStorage?: Record<string, string>,
) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      flowType: 'pkce',
      storage: createOAuthStorage(c, backingStorage),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function getOAuthApiCallbackUrl(c: Context<{ Bindings: Bindings; Variables: Variables }>): string {
  const publicApiUrl = c.env.API_PUBLIC_URL?.trim().replace(/\/$/, '');
  const apiOrigin = publicApiUrl || new URL(c.req.url).origin;
  return new URL('/api/v1/auth/oauth/callback', apiOrigin).toString();
}

function redirectWithOAuthError(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  redirectTo: string,
  error: string,
  description?: string,
) {
  const url = new URL(redirectTo);
  url.searchParams.set('error', error);
  if (description) {
    url.searchParams.set('error_description', description);
  }
  return c.redirect(url.toString(), 302);
}

async function getOAuthHandoff(c: Context<{ Bindings: Bindings; Variables: Variables }>, handoffId: string) {
  if (!c.env.AI_SESSIONS) {
    return null;
  }

  const raw = await c.env.AI_SESSIONS.get(`${OAUTH_HANDOFF_KV_PREFIX}${handoffId}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as OAuthHandoff;
  } catch {
    return null;
  }
}

async function putOAuthHandoff(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  handoffId: string,
  handoff: OAuthHandoff,
) {
  if (!c.env.AI_SESSIONS) {
    return;
  }

  await c.env.AI_SESSIONS.put(`${OAUTH_HANDOFF_KV_PREFIX}${handoffId}`, JSON.stringify(handoff), {
    expirationTtl: OAUTH_COOKIE_MAX_AGE,
  });
}

async function deleteOAuthHandoff(c: Context<{ Bindings: Bindings; Variables: Variables }>, handoffId: string) {
  if (!c.env.AI_SESSIONS) {
    return;
  }

  await c.env.AI_SESSIONS.delete(`${OAUTH_HANDOFF_KV_PREFIX}${handoffId}`);
}

async function getOAuthSession(c: Context<{ Bindings: Bindings; Variables: Variables }>, ticket: string) {
  if (!c.env.AI_SESSIONS) {
    return null;
  }

  const raw = await c.env.AI_SESSIONS.get(`${OAUTH_SESSION_KV_PREFIX}${ticket}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as OAuthSessionPayload;
  } catch {
    return null;
  }
}

async function putOAuthSession(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  ticket: string,
  sessionPayload: OAuthSessionPayload,
) {
  if (!c.env.AI_SESSIONS) {
    return;
  }

  await c.env.AI_SESSIONS.put(`${OAUTH_SESSION_KV_PREFIX}${ticket}`, JSON.stringify(sessionPayload), {
    expirationTtl: OAUTH_COOKIE_MAX_AGE,
  });
}

async function deleteOAuthSession(c: Context<{ Bindings: Bindings; Variables: Variables }>, ticket: string) {
  if (!c.env.AI_SESSIONS) {
    return;
  }

  await c.env.AI_SESSIONS.delete(`${OAUTH_SESSION_KV_PREFIX}${ticket}`);
}

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
    path: '/oauth/google',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: oauthStartSchema } },
      },
    },
    responses: {
      200: {
        description: 'Google OAuth provider redirect URL',
        content: { 'application/json': { schema: oauthUrlResponseSchema } },
      },
      400: { description: 'Invalid redirect URL or OAuth request', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const { redirect_to } = c.req.valid('json');

    if (!isAllowedOAuthRedirect(redirect_to)) {
      return c.json({ error: 'Invalid OAuth redirect URL' }, 400);
    }

    const handoffId = createRandomToken();
    const backingStorage: Record<string, string> = {};
    // GoTrue matches redirect_to against the allow-list as a whole string, query included, so any
    // query param here forces every entry to be a wildcard. Keep the URL bare and carry the
    // handoff/redirect state in cookies instead — they survive the Google round trip (SameSite=Lax
    // on a top-level GET).
    const apiCallbackUrl = getOAuthApiCallbackUrl(c);

    const supabase = createOAuthSupabaseClient(c, backingStorage);

    setCookie(c, OAUTH_REDIRECT_COOKIE, encodeCookieValue(redirect_to), oauthCookieOptions(c));
    setCookie(c, OAUTH_HANDOFF_COOKIE, handoffId, oauthCookieOptions(c));

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: apiCallbackUrl,
      },
    });

    if (error || !data.url) {
      deleteOAuthCookie(c, OAUTH_REDIRECT_COOKIE);
      deleteOAuthCookie(c, OAUTH_HANDOFF_COOKIE);
      return c.json({ error: error?.message || 'Failed to start Google OAuth' }, 400);
    }

    await putOAuthHandoff(c, handoffId, {
      redirect_to,
      storage: backingStorage,
    });

    return c.json({ url: data.url }, 200);
  },
);

auth.openapi(
  createRoute({
    method: 'get',
    path: '/oauth/callback',
    tags: ['Auth'],
    responses: {
      302: { description: 'Redirects back to the web OAuth callback page' },
      400: { description: 'Invalid OAuth callback', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const code = c.req.query('code');
    // Cookie is the primary channel; the query params stay supported for in-flight logins started
    // before the bare-callback-URL change.
    const handoffId = getCookie(c, OAUTH_HANDOFF_COOKIE) || c.req.query('handoff_id');
    const redirectParam = c.req.query('redirect_to');
    const redirectCookie = getCookie(c, OAUTH_REDIRECT_COOKIE);
    const handoff = handoffId ? await getOAuthHandoff(c, handoffId) : null;
    const redirectTo = handoff?.redirect_to || (redirectCookie ? decodeCookieValue(redirectCookie) : redirectParam || null);

    deleteOAuthCookie(c, OAUTH_REDIRECT_COOKIE);
    deleteOAuthCookie(c, OAUTH_HANDOFF_COOKIE);

    if (!redirectTo || !isAllowedOAuthRedirect(redirectTo)) {
      return c.json({ error: 'Invalid OAuth redirect URL' }, 400);
    }

    if (!code) {
      return redirectWithOAuthError(c, redirectTo, 'invalid_oauth_code');
    }

    if (!handoff) {
      return redirectWithOAuthError(c, redirectTo, 'oauth_handoff_failed');
    }

    const supabase = createOAuthSupabaseClient(c, handoff.storage);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (handoffId) {
      await deleteOAuthHandoff(c, handoffId);
    }

    if (error || !data.session) {
      return redirectWithOAuthError(c, redirectTo, 'oauth_session_failed', error?.message);
    }

    const ticket = createRandomToken();
    const sessionPayload = {
      user: data.user,
      session: data.session,
    };

    await putOAuthSession(c, ticket, sessionPayload);
    setCookie(c, `${OAUTH_SESSION_COOKIE_PREFIX}${ticket}`, encodeCookieValue(JSON.stringify(sessionPayload)), oauthCookieOptions(c));
    setCookie(c, OAUTH_TICKET_COOKIE, ticket, oauthCookieOptions(c));

    const url = new URL(redirectTo);
    url.searchParams.set('ticket', ticket);
    return c.redirect(url.toString(), 302);
  },
);

auth.openapi(
  createRoute({
    method: 'post',
    path: '/oauth/session',
    tags: ['Auth'],
    request: {
      body: {
        content: { 'application/json': { schema: oauthSessionSchema } },
      },
    },
    responses: {
      200: {
        description: 'OAuth Supabase session',
        content: { 'application/json': { schema: authResponseSchema } },
      },
      400: { description: 'Invalid or expired OAuth ticket', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    const { ticket } = c.req.valid('json');
    const cookieTicket = getCookie(c, OAUTH_TICKET_COOKIE);
    const cookieName = `${OAUTH_SESSION_COOKIE_PREFIX}${ticket}`;
    const kvSession = await getOAuthSession(c, ticket);

    deleteOAuthCookie(c, OAUTH_TICKET_COOKIE);
    deleteOAuthCookie(c, cookieName);

    if (kvSession) {
      await deleteOAuthSession(c, ticket);
      return c.json(kvSession, 200);
    }

    if (!cookieTicket || cookieTicket !== ticket) {
      return c.json({ error: 'Invalid or expired OAuth ticket' }, 400);
    }

    const encodedSession = getCookie(c, cookieName);

    if (!encodedSession) {
      return c.json({ error: 'Invalid or expired OAuth ticket' }, 400);
    }

    const decodedSession = decodeCookieValue(encodedSession);
    if (!decodedSession) {
      return c.json({ error: 'Invalid or expired OAuth ticket' }, 400);
    }

    try {
      return c.json(JSON.parse(decodedSession), 200);
    } catch {
      return c.json({ error: 'Invalid or expired OAuth ticket' }, 400);
    }
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
