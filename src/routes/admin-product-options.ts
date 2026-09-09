import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { getR2PublicUrl } from '../lib/media';

const adminProductOptions = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminProductOptions.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Product Options'],
    responses: {
      200: {
        description: 'List product options',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: z.number(),
                  name: z.string(),
                  code: z.string().nullable(),
                  category: z.string().nullable(),
                  is_combine: z.boolean(),
                  price: z.number(),
                  image_url: z.string().nullable(),
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
      const supabase = c.get('supabase');

      const { data: products, error } = await supabase
        .from('products')
        .select('id, name, code, category, is_combine, price, image_url')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      const origin = new URL(c.req.url).origin;

      const list = (products || []) as Array<{
        id: number;
        name: string;
        code: string | null;
        category: string | null;
        is_combine: boolean;
        price: number;
        image_url: string | null;
      }>;

      const data = list.map((row) => ({
        ...row,
        image_url: getR2PublicUrl(row.image_url, c.env.R2_PUBLIC_URL) ?? `${origin}/default.webp`,
      }));

      return c.json({ data }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminProductOptions;
