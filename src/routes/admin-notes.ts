import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminNotes = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const noteBodySchema = z.object({
  title: z.string(),
  body: z.string(),
});

const idParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path', required: true }, example: '1' }),
});

const errorResponse = z.object({ error: z.string() });

adminNotes.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Notes'],
    request: { query: z.object({ archived: z.enum(['true', 'false']).optional() }) },
    responses: {
      200: { description: 'List notes', content: { 'application/json': { schema: z.array(z.any()) } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const archived = c.req.query('archived') === 'true';
      let query = supabase
        .from('notes' as any)
        .select('id, title, body, created_at, updated_at, deleted_at')
        .order('updated_at', { ascending: false, nullsFirst: false });
      query = archived ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

      const { data, error } = await query;

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data || [], 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminNotes.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Notes'],
    request: { body: { content: { 'application/json': { schema: noteBodySchema } } } },
    responses: {
      201: { description: 'Note created', content: { 'application/json': { schema: z.any() } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const payload = c.req.valid('json');
      const { data, error } = await supabase
        .from('notes' as any)
        .insert({ title: payload.title, body: payload.body })
        .select('id, title, body, created_at, updated_at')
        .single();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data, 201);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminNotes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Notes'],
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: noteBodySchema } } },
    },
    responses: {
      200: { description: 'Note updated', content: { 'application/json': { schema: z.any() } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const payload = c.req.valid('json');
      const { data, error } = await supabase
        .from('notes' as any)
        .update({ title: payload.title, body: payload.body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, title, body, created_at, updated_at')
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) return c.json({ error: 'Note not found' }, 404);
      return c.json(data, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminNotes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin Notes'],
    request: { params: idParamSchema },
    responses: {
      204: { description: 'Note deleted' },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const { error } = await supabase
        .from('notes' as any)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) return c.json({ error: error.message }, 500);
      return c.body(null, 204);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminNotes.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/restore',
    tags: ['Admin Notes'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Note restored', content: { 'application/json': { schema: z.any() } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const { data, error } = await supabase
        .from('notes' as any)
        .update({ deleted_at: null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, title, body, created_at, updated_at, deleted_at')
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) return c.json({ error: 'Note not found' }, 404);
      return c.json(data, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminNotes.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/permanent',
    tags: ['Admin Notes'],
    request: { params: idParamSchema },
    responses: {
      204: { description: 'Note permanently deleted' },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const { error } = await supabase.from('notes' as any).delete().eq('id', id);

      if (error) return c.json({ error: error.message }, 500);
      return c.body(null, 204);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminNotes;
