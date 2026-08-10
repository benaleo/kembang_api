import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminCustomers = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const customerBodySchema = z.object({
  name: z.string(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  is_subscribed: z.boolean().optional(),
  distance: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  latitude: z.number().nullable().optional(),
  subs_at: z.string().nullable().optional(),
  subs_end_at: z.string().nullable().optional(),
  address_note: z.string().nullable().optional(),
});

const customerSchema = z.object({
  id: z.number(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  place: z.string().nullable(),
  is_subscribed: z.boolean(),
  distance: z.number().nullable(),
  longitude: z.number().nullable(),
  latitude: z.number().nullable(),
  subs_at: z.string().nullable(),
  subs_end_at: z.string().nullable(),
  address_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// List customers
adminCustomers.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Customers'],
    responses: {
      200: {
        description: 'List customers',
        content: { 'application/json': { schema: z.array(customerSchema) } },
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
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.json(data || []);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Get customer by ID
adminCustomers.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admin Customers'],
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
            description: 'Customer ID',
            required: true,
          },
          example: '1',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Customer details',
        content: { 'application/json': { schema: customerSchema } },
      },
      404: {
        description: 'Customer not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
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
      const { id } = c.req.valid('param');

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      if (!data) {
        return c.json({ error: 'Customer not found' }, 404);
      }

      return c.json(data);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Create customer
adminCustomers.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Customers'],
    request: {
      body: {
        content: { 'application/json': { schema: customerBodySchema } },
      },
    },
    responses: {
      201: {
        description: 'Customer created',
        content: { 'application/json': { schema: customerSchema } },
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
      const body = await c.req.json();

      const { data, error } = await supabase
        .from('customers')
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

// Update customer
adminCustomers.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Customers'],
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
            description: 'Customer ID',
            required: true,
          },
          example: '1',
        }),
      }),
      body: {
        content: { 'application/json': { schema: customerBodySchema.partial() } },
      },
    },
    responses: {
      200: {
        description: 'Customer updated',
        content: { 'application/json': { schema: customerSchema } },
      },
      404: {
        description: 'Customer not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
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
      const { id } = c.req.valid('param');
      const body = await c.req.json();

      const { data, error } = await supabase
        .from('customers')
        .update(body)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      if (!data) {
        return c.json({ error: 'Customer not found' }, 404);
      }

      return c.json(data);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Delete customer
adminCustomers.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin Customers'],
    request: {
      params: z.object({
        id: z.string().openapi({
          param: {
            name: 'id',
            in: 'path',
            description: 'Customer ID',
            required: true,
          },
          example: '1',
        }),
      }),
    },
    responses: {
      200: {
        description: 'Customer deleted',
        content: { 'application/json': { schema: z.object({ id: z.number() }) } },
      },
      404: {
        description: 'Customer not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
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
      const { id } = c.req.valid('param');

      const { data, error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      if (!data) {
        return c.json({ error: 'Customer not found' }, 404);
      }

      return c.json({ id: data.id });
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminCustomers;
