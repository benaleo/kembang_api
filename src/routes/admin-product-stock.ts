import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminProductStock = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const productStockSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  stocks: z.number().int(),
  date: z.string(),
  is_valid: z.boolean(),
  message: z.string().nullable(),
  created_at: z.string(),
});

const listProductStockQuerySchema = z.object({
  productId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

const createProductStockSchema = z.object({
  product_id: z.number().int().positive(),
  stocks: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const invalidateProductStockSchema = z.object({
  message: z.string().trim().min(1).max(500),
});

adminProductStock.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Product Stock'],
    request: { query: listProductStockQuerySchema },
    responses: {
      200: {
        description: 'List stock entries for a product',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(productStockSchema), total: z.number() }),
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
    const { productId, page, pageSize } = c.req.valid('query');
    const supabase = c.get('supabase');
    const from = (page - 1) * pageSize;

    try {
      const { data, error, count } = await supabase
        .from('product_stocks')
        .select('id, product_id, stocks, date, is_valid, message, created_at', { count: 'exact' })
        .eq('product_id', productId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) return c.json({ error: error.message }, 500);

      return c.json({ data: data ?? [], total: count ?? 0 }, 200);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'product stock list failed',
        productId,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Gagal memuat stock produk' }, 500);
    }
  },
);

adminProductStock.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Product Stock'],
    request: {
      body: { content: { 'application/json': { schema: createProductStockSchema } } },
    },
    responses: {
      201: {
        description: 'Product stock created',
        content: { 'application/json': { schema: productStockSchema } },
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
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    try {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id')
        .eq('id', body.product_id)
        .is('deleted_at', null)
        .maybeSingle();

      if (productError) return c.json({ error: productError.message }, 500);
      if (!product) return c.json({ error: 'Product not found' }, 404);

      const { data, error } = await supabase
        .from('product_stocks')
        .insert(body)
        .select('id, product_id, stocks, date, is_valid, message, created_at')
        .single();

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data, 201);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'product stock create failed',
        productId: body.product_id,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Gagal menambah stock produk' }, 500);
    }
  },
);

adminProductStock.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/invalidate',
    tags: ['Admin Product Stock'],
    request: {
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: { content: { 'application/json': { schema: invalidateProductStockSchema } } },
    },
    responses: {
      200: {
        description: 'Product stock invalidated',
        content: { 'application/json': { schema: productStockSchema } },
      },
      404: {
        description: 'Valid product stock not found',
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
    const { message } = c.req.valid('json');
    const supabase = c.get('supabase');

    try {
      const { data, error } = await supabase
        .from('product_stocks')
        .update({
          is_valid: false,
          message: `manual invalidated : ${message.trim()}`,
        })
        .eq('id', id)
        .eq('is_valid', true)
        .select('id, product_id, stocks, date, is_valid, message, created_at')
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) return c.json({ error: 'Stock tidak ditemukan atau sudah tidak valid' }, 404);
      return c.json(data, 200);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'product stock invalidation failed',
        stockId: id,
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Gagal menginvalidasi stock produk' }, 500);
    }
  },
);

adminProductStock.openapi(
  createRoute({
    method: 'post',
    path: '/reset',
    tags: ['Admin Product Stock'],
    responses: {
      200: {
        description: 'All valid stock entries invalidated',
        content: {
          'application/json': {
            schema: z.object({ message: z.string() }),
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
    const supabase = c.get('supabase');
    const message = `invalidated all at ${new Date().toISOString()}`;

    try {
      const { error } = await supabase
        .from('product_stocks')
        .update({ is_valid: false, message })
        .eq('is_valid', true);

      if (error) return c.json({ error: error.message }, 500);
      return c.json({ message }, 200);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'product stock reset failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      return c.json({ error: 'Gagal mereset stock produk' }, 500);
    }
  },
);

export default adminProductStock;
