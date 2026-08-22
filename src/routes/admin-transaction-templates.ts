import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminTransactionTemplates = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const templateBodySchema = z.object({
  name: z.string(),
  date: z.string(),
  user_id: z.number().optional(),
});

const listQuerySchema = z.object({
  keyword: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(10),
});

const idParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path', required: true }, example: '1' }),
});

const errorResponse = z.object({ error: z.string() });

adminTransactionTemplates.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Transaction Templates'],
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: 'List transaction templates',
        content: { 'application/json': { schema: z.object({ data: z.array(z.any()), total: z.number() }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { keyword, page, page_size } = c.req.valid('query');
      const from = (page - 1) * page_size;
      const to = from + page_size - 1;

      let query = supabase
        .from('transaction_templates' as any)
        .select('id, name, date, created_at, updated_at', { count: 'exact' })
        .range(from, to)
        .order('id', { ascending: true });

      if (keyword?.trim()) {
        query = query.ilike('name', `%${keyword.trim()}%`);
      }

      const { data, count, error } = await query;
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ data: data || [], total: count ?? 0 });
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminTransactionTemplates.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admin Transaction Templates'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Transaction template detail', content: { 'application/json': { schema: z.any() } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const { data, error } = await supabase
        .from('transaction_templates' as any)
        .select('id, name, date, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data ?? null);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminTransactionTemplates.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Transaction Templates'],
    request: { body: { content: { 'application/json': { schema: templateBodySchema } } } },
    responses: {
      201: { description: 'Transaction template created', content: { 'application/json': { schema: z.any() } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const payload = c.req.valid('json');
      const { data, error } = await supabase
        .from('transaction_templates' as any)
        .insert([payload])
        .select('id, name, date, created_at, updated_at')
        .single();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data, 201);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminTransactionTemplates.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Transaction Templates'],
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: templateBodySchema } } },
    },
    responses: {
      200: { description: 'Transaction template updated', content: { 'application/json': { schema: z.any() } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const payload = c.req.valid('json');
      const { data, error } = await supabase
        .from('transaction_templates' as any)
        .update(payload)
        .eq('id', id)
        .select('id, name, date, created_at, updated_at')
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data ?? null);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminTransactionTemplates.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin Transaction Templates'],
    request: { params: idParamSchema },
    responses: {
      204: { description: 'Transaction template deleted' },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const { error } = await supabase.from('transaction_templates' as any).delete().eq('id', id);

      if (error) return c.json({ error: error.message }, 500);
      return c.body(null, 204);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminTransactionTemplates;
