import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { computeDistance } from '../lib/gomaps';

const addresses = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const addressBodySchema = z.object({
  label: z.string().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_phone: z.string().nullable().optional(),
  recipient_address: z.string().nullable().optional(),
  recipient_address_detail: z.string().nullable().optional(),
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
  recipient_phone: z.string().nullable(),
  recipient_name: z.string().nullable(),
  recipient_geo: z.any().nullable(),
  recipient_distances: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const normalizeRecipientGeo = (recipientGeo: z.infer<typeof addressBodySchema>['recipient_geo']) => {
  if (
    recipientGeo &&
    typeof recipientGeo.lat === 'number' &&
    typeof recipientGeo.lng === 'number'
  ) {
    return { lat: recipientGeo.lat, lng: recipientGeo.lng };
  }

  return null;
};

// GET - List user's addresses
addresses.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Addresses'],
    responses: {
      200: {
        description: "List user's addresses",
        content: { 'application/json': { schema: z.array(addressSchema) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('customer_addresses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  }
);

// POST - Create address
addresses.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Addresses'],
    request: {
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
    const userId = c.get('userId');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    const { data: customerRow } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    const customer = customerRow as { id: number } | null;

    // first address auto-default
    const { count } = await supabase
      .from('customer_addresses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    const isDefault = count === 0 ? true : (body.is_default ?? false);

    const { data, error } = await (supabase.from('customer_addresses') as any)
      .insert([{ ...body, user_id: userId, customer_id: customer?.id ?? null, recipient_distances: 0, is_default: isDefault }])
      .select()
      .single();

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data, 201);
  }
);

// PATCH - Update address (ownership check required)
addresses.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Addresses'],
    request: {
      params: z.object({ id: z.coerce.number() }),
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
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('customer_addresses')
      .select('user_id, recipient_distances')
      .eq('id', id)
      .single();

    const currentAddress = existing as { user_id: string | null; recipient_distances: number | null } | null;

    if (!currentAddress) {
      return c.json({ error: 'Address not found' }, 404);
    }

    if (currentAddress.user_id !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const shouldRecomputeDistance =
      body.recipient_address !== undefined || body.recipient_geo !== undefined;
    const recipientDistances = shouldRecomputeDistance
      ? await computeDistance({
          recipient_address: body.recipient_address ?? null,
          recipient_geo: normalizeRecipientGeo(body.recipient_geo),
        })
      : currentAddress.recipient_distances ?? 0;
    const updateBody = shouldRecomputeDistance
      ? { ...body, recipient_distances: recipientDistances }
      : body;

    // if setting this address as default, reset all others first
    if (body.is_default) {
      await (supabase.from('customer_addresses') as any)
        .update({ is_default: false })
        .eq('user_id', userId)
        .neq('id', id);
    }

    const { data, error } = await (supabase.from('customer_addresses') as any)
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

// DELETE - Delete address (ownership check required)
addresses.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Addresses'],
    request: {
      params: z.object({ id: z.coerce.number() }),
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
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('customer_addresses')
      .select('user_id')
      .eq('id', id)
      .single();

    const currentAddress = existing as { user_id: string | null } | null;

    if (!currentAddress) {
      return c.json({ error: 'Address not found' }, 404);
    }

    if (currentAddress.user_id !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const { error } = await (supabase.from('customer_addresses') as any)
      .delete()
      .eq('id', id);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: 'Address deleted' });
  }
);

export default addresses;
