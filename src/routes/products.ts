import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { getR2PublicUrl } from '../lib/media';
import { Bindings, Variables } from '../types';

const products = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const productSchema = z.object({
  id: z.number(),
  name: z.string(),
  price: z.number(),
  price_now: z.number().nullable(),
  image_url: z.string(),
  category: z.string().nullable(),
  is_combine: z.boolean(),
});

products.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Products'],
    request: {
      query: z.object({
        category: z.string().optional(),
        search: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'List products',
        content: { 'application/json': { schema: z.array(productSchema) } },
      },
      500: {
        description: 'Internal error',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { category, search } = c.req.valid('query');
    const supabase = c.get('supabase');

    let q = supabase
      .from('products')
      .select('id, name, price, price_now, image_url, category, is_combine')
      .eq('is_active', true);

    if (category) q = q.eq('category', category);
    if (search) q = q.ilike('name', `%${search}%`);

    const { data, error } = await q.order('price_now', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Failed to fetch products:', error);
      return c.json({ message: 'Failed to fetch products' }, 500);
    }

    const origin = new URL(c.req.url).origin;

    const result = (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      price_now: row.price_now,
      image_url: getR2PublicUrl(row.image_url, c.env.R2_PUBLIC_URL) ?? `${origin}/default.webp`,
      category: row.category,
      is_combine: row.is_combine,
    }));

    return c.json(result, 200);
  },
);

export default products;
