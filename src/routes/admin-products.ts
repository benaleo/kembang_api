import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminProducts = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const productBodySchema = z.object({
  name: z.string(),
  code: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  price: z.number().int().optional(),
  is_active: z.boolean().optional(),
  is_combine: z.boolean().optional(),
  price_now: z.number().nullable().optional(),
  image_url: z.string().nullable().optional(),
});

const productSchema = z.object({
  id: z.number(),
  code: z.string().nullable(),
  name: z.string(),
  category: z.string().nullable(),
  price: z.number(),
  is_active: z.boolean(),
  is_combine: z.boolean(),
  price_now: z.number().nullable(),
  image_url: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const listProductsQuerySchema = z.object({
  keyword: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

// List products
adminProducts.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Products'],
    request: {
      query: listProductsQuerySchema,
    },
    responses: {
      200: {
        description: 'List products',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(productSchema), total: z.number() }),
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
    const { keyword, page, pageSize } = c.req.valid('query');
    const supabase = c.get('supabase');

    try {
      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (keyword) {
        query = query.ilike('name', `%${keyword}%`);
      }

      const { data, error, count } = await query;

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.json({ data: data ?? [], total: count ?? 0 });
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Get product by ID
adminProducts.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admin Products'],
    request: {
      params: z.object({ id: z.coerce.number().int() }),
    },
    responses: {
      200: {
        description: 'Product found',
        content: {
          'application/json': {
            schema: productSchema,
          },
        },
      },
      404: {
        description: 'Product not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const supabase = c.get('supabase');

    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      if (!data) {
        return c.json({ error: 'Product not found' }, 404);
      }

      return c.json(data);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Create product
adminProducts.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Products'],
    request: {
      body: {
        content: { 'application/json': { schema: productBodySchema } },
      },
    },
    responses: {
      201: {
        description: 'Product created',
        content: {
          'application/json': {
            schema: productSchema,
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
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    try {
      const { data, error } = await supabase
        .from('products')
        .insert([body])
        .select()
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.json(data, 201);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Update product
adminProducts.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Products'],
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: { 'application/json': { schema: productBodySchema.partial() } },
      },
    },
    responses: {
      200: {
        description: 'Product updated',
        content: {
          'application/json': {
            schema: productSchema,
          },
        },
      },
      404: {
        description: 'Product not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    try {
      const { data, error } = await supabase
        .from('products')
        .update(body)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      if (!data) {
        return c.json({ error: 'Product not found' }, 404);
      }

      return c.json(data);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminProducts;
