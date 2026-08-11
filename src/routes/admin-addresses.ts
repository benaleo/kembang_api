import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { getDistanceKm } from '../lib/gomaps';

const adminAddresses = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const addressBodySchema = z.object({
  label: z.string().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_phone: z.string().nullable().optional(),
  recipient_address: z.string().nullable().optional(),
  recipient_address_detail: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  recipient_geo: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  is_default: z.boolean().optional(),
});

const addressSchema = z.object({
  id: z.number(),
  user_id: z.string().nullable(),
  customer_id: z.number().nullable(),
  is_default: z.boolean(),
  label: z.string().nullable(),
  recipient_address: z.string().nullable(),
  recipient_address_detail: z.string().nullable(),
  place: z.string().nullable(),
  recipient_phone: z.string().nullable(),
  recipient_name: z.string().nullable(),
  recipient_geo: z.any().nullable(),
  recipient_distances: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// GET - List customer's addresses (admin)
adminAddresses.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Addresses'],
    request: {
      params: z.object({ customerId: z.coerce.number() }),
    },
    responses: {
      200: {
        description: "List customer's addresses",
        content: { 'application/json': { schema: z.array(addressSchema) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { customerId } = c.req.valid('param');
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('customer_addresses')
      .select('*')
      .eq('customer_id', customerId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  }
);

// POST - Create address for customer (admin)
adminAddresses.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Addresses'],
    request: {
      params: z.object({ customerId: z.coerce.number() }),
      body: {
        content: { 'application/json': { schema: addressBodySchema } },
      },
    },
    responses: {
      201: {
        description: 'Address created',
        content: { 'application/json': { schema: addressSchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { customerId } = c.req.valid('param');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    // first address for this customer auto-default
    const { count } = await supabase
      .from('customer_addresses')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId);
    const isDefault = count === 0 ? true : (body.is_default ?? false);

    if (isDefault) {
      await supabase
        .from('customer_addresses')
        .update({ is_default: false })
        .eq('customer_id', customerId);
    }

    let recipientDistances = 0;
    if (body.recipient_address) {
      try {
        recipientDistances = await getDistanceKm(c.env.GOMAPS_APIKEY, body.recipient_address);
      } catch (e) {
        console.error('GoMaps distance failed:', e);
      }
    }

    const { data, error } = await supabase
      .from('customer_addresses')
      .insert([{ ...body, user_id: null, customer_id: customerId, recipient_distances: recipientDistances, is_default: isDefault }])
      .select()
      .single();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data, 201);
  }
);

// PATCH - Update address (customer_id ownership check)
adminAddresses.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Addresses'],
    request: {
      params: z.object({ customerId: z.coerce.number(), id: z.coerce.number() }),
      body: {
        content: { 'application/json': { schema: addressBodySchema } },
      },
    },
    responses: {
      200: {
        description: 'Address updated',
        content: { 'application/json': { schema: addressSchema } },
      },
      403: {
        description: 'Forbidden',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      404: {
        description: 'Address not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { customerId, id } = c.req.valid('param');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('customer_addresses')
      .select('customer_id')
      .eq('id', id)
      .single();

    if (!existing) {
      return c.json({ error: 'Address not found' }, 404);
    }

    if (existing.customer_id !== customerId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // if setting this address as default, reset all others first
    if (body.is_default) {
      await supabase
        .from('customer_addresses')
        .update({ is_default: false })
        .eq('customer_id', customerId)
        .neq('id', id);
    }

    let updateBody: typeof body & { recipient_distances?: number } = body;
    if (body.recipient_address) {
      try {
        const recipientDistances = await getDistanceKm(c.env.GOMAPS_APIKEY, body.recipient_address);
        updateBody = { ...body, recipient_distances: recipientDistances };
      } catch (e) {
        console.error('GoMaps distance failed:', e);
      }
    }

    const { data, error } = await supabase
      .from('customer_addresses')
      .update(updateBody)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  }
);

// DELETE - Remove address (customer_id ownership check)
adminAddresses.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin Addresses'],
    request: {
      params: z.object({ customerId: z.coerce.number(), id: z.coerce.number() }),
    },
    responses: {
      200: {
        description: 'Address deleted',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
      403: {
        description: 'Forbidden',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      404: {
        description: 'Address not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { customerId, id } = c.req.valid('param');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('customer_addresses')
      .select('customer_id')
      .eq('id', id)
      .single();

    if (!existing) {
      return c.json({ error: 'Address not found' }, 404);
    }

    if (existing.customer_id !== customerId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const { error } = await supabase
      .from('customer_addresses')
      .delete()
      .eq('id', id);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: 'Address deleted' });
  }
);

export default adminAddresses;
