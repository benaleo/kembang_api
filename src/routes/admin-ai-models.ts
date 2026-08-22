import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminAiModels = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const errorResponse = z.object({ error: z.string() });

const aiModelBodySchema = z.object({
  name: z.string(),
  model_id: z.string(),
  rpm_limit: z.number().int(),
  rpd_limit: z.number().int(),
  priority: z.number().int(),
  supports_tools: z.boolean(),
  is_active: z.boolean(),
});

const aiModelUpdateSchema = aiModelBodySchema.partial();

const listQuerySchema = z.object({
  keyword: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(10),
});

const idParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path', required: true }, example: '1' }),
});

adminAiModels.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin AI Models'],
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: 'List AI models',
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
        .from('ai_models' as any)
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .range(from, to)
        .order('priority', { ascending: true });

      if (keyword?.trim()) {
        query = query.ilike('name', `%${keyword.trim()}%`);
      }

      const { data, error, count } = await query;
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ data: data || [], total: count ?? 0 }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminAiModels.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admin AI Models'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'AI model detail', content: { 'application/json': { schema: z.any() } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);

      const { data, error } = await supabase
        .from('ai_models' as any)
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data ?? null, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminAiModels.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin AI Models'],
    request: { body: { content: { 'application/json': { schema: aiModelBodySchema } } } },
    responses: {
      201: { description: 'AI model created', content: { 'application/json': { schema: z.any() } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const payload = c.req.valid('json');
      const { data, error } = await supabase.from('ai_models' as any).insert(payload).select('*').single();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data, 201);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminAiModels.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin AI Models'],
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: aiModelUpdateSchema } } },
    },
    responses: {
      200: { description: 'AI model updated', content: { 'application/json': { schema: z.any() } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const updates = c.req.valid('json');
      const { data, error } = await supabase
        .from('ai_models' as any)
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) return c.json({ error: 'AI model not found' }, 404);
      return c.json(data, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

adminAiModels.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin AI Models'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'AI model deleted', content: { 'application/json': { schema: z.object({ id: z.number() }) } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const id = Number(c.req.valid('param').id);
      const { data, error } = await supabase
        .from('ai_models' as any)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) return c.json({ error: 'AI model not found' }, 404);
      return c.json(data, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminAiModels;
