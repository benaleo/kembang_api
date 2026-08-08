import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createClient } from '@supabase/supabase-js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

type Variables = {
  supabase: ReturnType<typeof createClient>;
};

const carts = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// GET - Get user's cart items
carts.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Carts'],
    request: {
      query: z.object({
        user_id: z.string().describe('User ID'),
      }),
    },
    responses: {
      200: {
        description: 'List user cart items',
        content: {
          'application/json': {
            schema: z.array(z.object({
              id: z.number(),
              user_id: z.string().nullable(),
              product_id: z.number().nullable(),
              created_at: z.string(),
            })),
          },
        },
      },
    },
  }),
  async (c) => {
    const { user_id } = c.req.valid('query');
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('product_cards')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  }
);

// POST - Add item to cart
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
              user_id: z.string(),
              product_id: z.number(),
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
              user_id: z.string().nullable(),
              product_id: z.number().nullable(),
              created_at: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { user_id, product_id } = await c.req.json();
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('product_cards')
      .insert([{ user_id, product_id }])
      .select()
      .single();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data, 201);
  }
);

// DELETE - Remove item from cart
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
        content: {
          'application/json': {
            schema: z.object({ message: z.string() }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const supabase = c.get('supabase');

    const { error } = await supabase
      .from('product_cards')
      .delete()
      .eq('id', id);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: 'Item removed from cart' });
  }
);

export default carts;
