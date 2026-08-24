import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const PIN_KEY = 'PIN';
const RESERVED_MASKED_KEYS = [PIN_KEY];

const adminSettings = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET / — List settings (pin value masked, only has_pin exposed)
// ---------------------------------------------------------------------------

adminSettings.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Settings'],
    responses: {
      200: {
        description: 'List of app settings',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  key: z.string(),
                  value: z.unknown().nullable(),
                  is_active: z.boolean(),
                  has_pin: z.boolean().optional(),
                }),
              ),
            }),
          },
        },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { data, error } = await supabase.from('app_settings').select('*');
      if (error) return c.json({ error: error.message }, 500);

      const rows = (data || []) as Array<{ key: string; value: unknown; is_active: boolean }>;
      return c.json(
        {
          data: rows.map((row) =>
            RESERVED_MASKED_KEYS.includes(row.key)
              ? { key: row.key, value: null, is_active: row.is_active, has_pin: true }
              : { ...row, has_pin: false },
          ),
        },
        200,
      );
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /verify-pin — Validate the settings PIN (always valid when no pin set)
// ---------------------------------------------------------------------------

adminSettings.openapi(
  createRoute({
    method: 'post',
    path: '/verify-pin',
    tags: ['Admin Settings'],
    request: {
      body: {
        content: {
          'application/json': { schema: z.object({ pin: z.string().min(1) }) },
        },
      },
    },
    responses: {
      200: {
        description: 'Pin verification result',
        content: { 'application/json': { schema: z.object({ valid: z.boolean() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { pin } = c.req.valid('json');

      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', PIN_KEY)
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);

      // Normalize the stored value: supports {"pin": "..."}, "..." and number shapes
      const stored = data?.value as unknown;
      let expected: string | null = null;
      if (typeof stored === 'string') expected = stored;
      else if (typeof stored === 'number') expected = String(stored);
      else if (stored && typeof stored === 'object' && 'pin' in (stored as object)) {
        const p = (stored as { pin: unknown }).pin;
        if (p !== undefined && p !== null) expected = String(p);
      }

      // No pin configured in DB — access is allowed
      if (!expected) return c.json({ valid: true }, 200);

      return c.json({ valid: expected === pin }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /{key} — Upsert a setting (value and/or is_active)
// ---------------------------------------------------------------------------

adminSettings.openapi(
  createRoute({
    method: 'put',
    path: '/{key}',
    tags: ['Admin Settings'],
    request: {
      params: z.object({ key: z.string().min(1) }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              value: z.unknown().nullable().optional(),
              is_active: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Setting saved',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { key } = c.req.valid('param');
      const { value, is_active } = c.req.valid('json');

      const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (value !== undefined) payload.value = value;
      if (is_active !== undefined) payload.is_active = is_active;

      const { error } = await supabase
        .from('app_settings')
        .upsert({ key, ...payload }, { onConflict: 'key' });

      if (error) return c.json({ error: error.message }, 500);
      return c.json({ success: true }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminSettings;
