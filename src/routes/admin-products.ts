import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import {
  convertImageToWebp,
  getImageExtension,
  getR2PublicUrl,
  hasValidImageSignature,
  MAX_IMAGE_SIZE,
  PRODUCT_IMAGE_KEY_PATTERN,
  WEBP_CONTENT_TYPE,
} from '../lib/media';

const adminProducts = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const productBodySchema = z.object({
  name: z.string(),
  code: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  price: z.number().int().optional(),
  is_active: z.boolean().optional(),
  is_combine: z.boolean().optional(),
  price_now: z.number().nullable().optional(),
  image_url: z.string().regex(PRODUCT_IMAGE_KEY_PATTERN).nullable().optional(),
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
  image_public_url: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const productListSchema = productSchema.extend({
  stock_total: z.number().int(),
});

const listProductsQuerySchema = z.object({
  keyword: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

function withPublicImageUrl(product: any, publicBaseUrl: string) {
  return {
    ...product,
    image_public_url: getR2PublicUrl(product.image_url, publicBaseUrl),
  };
}

async function getValidStockTotals(supabase: any, productIds: number[]) {
  const totals = new Map<number, number>();
  if (productIds.length === 0) return totals;

  const { data, error } = await supabase.rpc('get_product_valid_stock_totals', {
    p_product_ids: productIds,
  });

  if (error) throw error;
  for (const row of data ?? []) totals.set(Number(row.product_id), Number(row.stock_total));
  return totals;
}

adminProducts.post('/media', async (c) => {
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > 6 * 1024 * 1024) return c.json({ error: 'Ukuran request terlalu besar' }, 413);

  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'Photo wajib diisi' }, 400);

  const extension = getImageExtension(file.type);
  if (!extension) return c.json({ error: 'Format photo harus JPEG, PNG, WebP, atau AVIF' }, 400);
  if (file.size > MAX_IMAGE_SIZE) return c.json({ error: 'Ukuran photo maksimal 5 MB' }, 400);
  if (!(await hasValidImageSignature(file))) return c.json({ error: 'Isi file tidak sesuai format photo' }, 400);

  const path = `products/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.webp`;
  try {
    const webp = await convertImageToWebp(c.env.IMAGES, file);
    await c.env.SITE_CONTENT_BUCKET.put(path, webp, {
      httpMetadata: {
        contentType: WEBP_CONTENT_TYPE,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'product photo upload failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Gagal menyimpan photo produk' }, 500);
  }

  return c.json({
    path,
    url: getR2PublicUrl(path, c.env.R2_PUBLIC_URL),
  }, 201);
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
            schema: z.object({ data: z.array(productListSchema), total: z.number() }),
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
    const { keyword, category, page, pageSize } = c.req.valid('query');
    const supabase = c.get('supabase');

    try {
      let query = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (keyword) {
        query = query.or(`name.ilike.%${keyword}%,code.ilike.%${keyword}%`);
      }

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error, count } = await query;

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      const products = data ?? [];
      const stockTotals = await getValidStockTotals(
        supabase,
        products.map((product: any) => product.id),
      );

      return c.json({
        data: products.map((product: any) => ({
          ...withPublicImageUrl(product, c.env.R2_PUBLIC_URL),
          stock_total: stockTotals.get(product.id) ?? 0,
        })),
        total: count ?? 0,
      }, 200);
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

      return c.json(withPublicImageUrl(data, c.env.R2_PUBLIC_URL), 200);
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

      return c.json(withPublicImageUrl(data, c.env.R2_PUBLIC_URL), 201);
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

      return c.json(withPublicImageUrl(data, c.env.R2_PUBLIC_URL), 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminProducts;
