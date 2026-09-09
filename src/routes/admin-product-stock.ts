import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminProductStock = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const productStockSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  stocks: z.number().int(),
  date: z.string(),
  created_at: z.string(),
});

const listProductStockQuerySchema = z.object({
  productId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
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
        .select('id, product_id, stocks, date, created_at', { count: 'exact' })
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

export default adminProductStock;
