import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const carts = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const productSummarySchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  price: z.number().nullable(),
  price_now: z.number().nullable(),
  image_url: z.string().nullable(),
  category: z.string().nullable(),
});

const cartItemSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  quantity: z.number(),
  created_at: z.string(),
  product: productSummarySchema.nullable(),
});

const errorSchema = z.object({ error: z.string() });

// GET - List current user's cart items
carts.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Carts'],
    responses: {
      200: {
        description: "List user's cart items",
        content: { 'application/json': { schema: z.array(cartItemSchema) } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorSchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('product_carts')
      .select('id, product_id, quantity, created_at, products(id, name, price, price_now, image_url, category)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    const items = (data ?? []).map((row: any) => ({
      id: row.id,
      product_id: row.product_id,
      quantity: row.quantity,
      created_at: row.created_at,
      product: row.products ?? null,
    }));

    return c.json(items);
  }
);

// POST - Add item to cart (upsert: increments quantity if already present)
carts.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Carts'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              product_id: z.number(),
              quantity: z.number().int().positive().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Item added to cart',
        content: {
          'application/json': {
            schema: z.object({
              id: z.number(),
              product_id: z.number(),
              quantity: z.number(),
              created_at: z.string(),
            }),
          },
        },
      },
      400: {
        description: 'Invalid product',
        content: { 'application/json': { schema: errorSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorSchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const { product_id, quantity } = await c.req.json();
    const addQty = quantity ?? 1;
    const supabase = c.get('supabase');

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id')
      .eq('id', product_id)
      .maybeSingle();

    if (productError) {
      return c.json({ error: productError.message }, 500);
    }
    if (!product) {
      return c.json({ error: 'Product not found' }, 400);
    }

    const { data: existing, error: existingError } = await supabase
      .from('product_carts')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('product_id', product_id)
      .maybeSingle();

    if (existingError) {
      return c.json({ error: existingError.message }, 500);
    }

    if (existing) {
      const { data, error } = await supabase
        .from('product_carts')
        .update({ quantity: existing.quantity + addQty })
        .eq('id', existing.id)
        .select('id, product_id, quantity, created_at')
        .single();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.json(data, 201);
    }

    const { data, error } = await supabase
      .from('product_carts')
      .insert([{ user_id: userId, product_id, quantity: addQty }])
      .select('id, product_id, quantity, created_at')
      .single();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data, 201);
  }
);

// PATCH - Update quantity of a cart item (deletes it if quantity <= 0)
carts.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Carts'],
    request: {
      params: z.object({
        id: z.string().describe('Cart item ID'),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              quantity: z.number().int(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Cart item updated',
        content: {
          'application/json': {
            schema: z.object({
              id: z.number(),
              product_id: z.number(),
              quantity: z.number(),
              created_at: z.string(),
            }).or(z.object({ message: z.string() })),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorSchema } },
      },
      404: {
        description: 'Cart item not found',
        content: { 'application/json': { schema: errorSchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const { quantity } = await c.req.json();
    const supabase = c.get('supabase');

    const { data: existing, error: existingError } = await supabase
      .from('product_carts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingError) {
      return c.json({ error: existingError.message }, 500);
    }
    if (!existing) {
      return c.json({ error: 'Cart item not found' }, 404);
    }

    if (quantity <= 0) {
      const { error } = await supabase
        .from('product_carts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.json({ message: 'Item removed from cart' });
    }

    const { data, error } = await supabase
      .from('product_carts')
      .update({ quantity })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, product_id, quantity, created_at')
      .single();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  }
);

// DELETE - Remove a single item from cart
carts.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Carts'],
    request: {
      params: z.object({
        id: z.string().describe('Cart item ID'),
      }),
    },
    responses: {
      200: {
        description: 'Item removed from cart',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorSchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const supabase = c.get('supabase');

    const { error } = await supabase
      .from('product_carts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: 'Item removed from cart' });
  }
);

// DELETE - Clear all cart items for the current user
carts.openapi(
  createRoute({
    method: 'delete',
    path: '/',
    tags: ['Carts'],
    responses: {
      200: {
        description: 'Cart cleared',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorSchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    const { error } = await supabase
      .from('product_carts')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: 'Cart cleared' });
  }
);

export default carts;
