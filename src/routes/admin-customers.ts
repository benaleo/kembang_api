import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { computeDistance, getDistanceKm } from '../lib/gomaps';

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
  customer_addresses: z.array(z.object({
    label: z.string().nullable().optional(),
    recipient_name: z.string().nullable().optional(),
    recipient_phone: z.string().nullable().optional(),
    recipient_address: z.string().nullable().optional(),
    recipient_address_detail: z.string().nullable().optional(),
    place: z.string().nullable().optional(),
    recipient_geo: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
    recipient_distances: z.number().nullable().optional(),
    is_default: z.boolean().optional(),
  })).optional(),
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

const listCustomersQuerySchema = z.object({
  keyword: z.string().optional(),
  isSubscribed: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

// List customers
adminCustomers.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Customers'],
    request: {
      query: listCustomersQuerySchema,
    },
    responses: {
      200: {
        description: 'List customers',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(customerSchema), total: z.number() }),
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
      const { keyword, isSubscribed, page, pageSize } = c.req.valid('query');

      let query = supabase.from('customers').select('*', { count: 'exact' });

      if (keyword) {
        // keyword di-escape: koma & tanda kurung memutus sintaks filter PostgREST
        const safe = keyword.replace(/[,()]/g, ' ');
        query = query.or(`name.ilike.%${safe}%,address.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
      if (isSubscribed !== undefined) {
        query = query.eq('is_subscribed', isSubscribed === 'true');
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      const customers = data || [];

      // alamat & jarak yang ditampilkan diambil dari customer_addresses default (is_default=true).
      // customer_addresses tidak punya FK ke customers, jadi merge manual per customer_id.
      if (customers.length > 0) {
        const ids = customers.map((row: { id: number }) => row.id);
        const { data: addresses } = await supabase
          .from('customer_addresses')
          .select('customer_id, recipient_address, recipient_address_detail, recipient_distances, place')
          .in('customer_id', ids)
          .eq('is_default', true);

        const defaultByCustomer = new Map<number, { recipient_address: string | null; recipient_address_detail: string | null; recipient_distances: number | null; place: string | null }>();
        for (const addr of addresses || []) {
          if (!defaultByCustomer.has(addr.customer_id)) {
            defaultByCustomer.set(addr.customer_id, addr);
          }
        }

        for (const row of customers) {
          const def = defaultByCustomer.get(row.id);
          if (def) {
            row.address = def.recipient_address ?? row.address;
            row.address_detail = def.recipient_address_detail ?? row.address_detail;
            row.distance = def.recipient_distances ?? row.distance;
            row.place = def.place ?? row.place;
          }
        }
      }

      return c.json({ data: customers, total: count ?? 0 }, 200);
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

      return c.json(data, 200);
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
      const { customer_addresses, ...customerData } = c.req.valid('json');

      const { data, error } = await supabase
        .from('customers')
        .insert([customerData])
        .select()
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      // Insert bundled addresses if provided
      if (customer_addresses?.length && data?.id) {
        // First-address auto-default: if no address is marked default, mark the first one
        const hasDefault = customer_addresses.some((a: any) => a.is_default);
        if (!hasDefault) customer_addresses[0].is_default = true;

        const rows = await Promise.all(
          customer_addresses.map(async (addr: any) => {
            let dist = addr.recipient_distances ?? 0;
            if (addr.recipient_distances == null) {
              try { dist = await computeDistance(c.env.GEOAPIFY_API_KEY, addr); } catch (e) {
                console.error('Distance calculation failed:', e);
              }
            }
            return {
              ...addr,
              user_id: null,
              customer_id: data.id,
              recipient_distances: dist,
            };
          }),
        );

        const { error: addrError } = await supabase
          .from('customer_addresses')
          .insert(rows);

        if (addrError) {
          console.error('Failed to insert customer addresses:', addrError);
          return c.json({ error: addrError.message }, 500);
        }
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

      return c.json(data, 200);
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

      return c.json({ id: data.id }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /{id}/history — Paginated transaction history for a customer
// ---------------------------------------------------------------------------

adminCustomers.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/history',
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
      query: z.object({
        keyword: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(10),
      }),
    },
    responses: {
      200: {
        description: 'Customer transaction history',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(z.record(z.any())), total: z.number() }),
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
      const customerId = Number(c.req.valid('param').id);
      const { keyword, page, pageSize } = c.req.valid('query');

      const offset = (page - 1) * pageSize;

      let query = supabase
        .from('transactions')
        .select(
          `
          id,
          date,
          name_alter,
          customer_id,
          customer_name,
          customer_phone,
          customer_address,
          note,
          note_route,
          route,
          cost_delivery,
          billed_at,
          is_web_order,
          status,
          customer:customers (
            name,
            address,
            address_note,
            distance,
            phone,
            place
          ),
          transaction_products (
            product:products (
              name,
              price
            ),
            qty
          )
        `,
          { count: 'exact' },
        )
        .eq('customer_id', customerId)
        .is('template_id', null)
        .order('date', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (keyword && keyword.trim()) {
        const kw = keyword.trim();
        query = query.or(`note.ilike.%${kw}%,note_route.ilike.%${kw}%`);
      }

      const { data, count, error } = await query;
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ data: data || [], total: count ?? 0 }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /sync-distances — Compute & store road distance for customers with distance=0
// ---------------------------------------------------------------------------

adminCustomers.openapi(
  createRoute({
    method: 'post',
    path: '/sync-distances',
    tags: ['Admin Customers'],
    request: {
      body: { content: { 'application/json': { schema: z.object({}).passthrough().optional() } } },
    },
    responses: {
      200: {
        description: 'Sync summary',
        content: {
          'application/json': {
            schema: z.object({
              updated: z.number(),
              failed: z.number(),
              skipped: z.number(),
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

      const { data: customers, error } = await supabase
        .from('customers')
        .select('id, longitude, latitude')
        .eq('distance', 0)
        .not('longitude', 'is', null)
        .not('latitude', 'is', null);

      if (error) return c.json({ error: error.message }, 500);
      if (!customers || customers.length === 0) {
        return c.json({ updated: 0, failed: 0, skipped: 0 }, 200);
      }

      let updated = 0;
      let failed = 0;

      // Process sequentially to avoid hammering the routing service
      for (const customer of customers) {
        try {
          if (!customer.longitude || !customer.latitude) {
            continue;
          }
          const distanceKm = await getDistanceKm(customer.latitude, customer.longitude);
          const rounded = Number(distanceKm.toFixed(1));
          const { error: updateError } = await supabase
            .from('customers')
            .update({ distance: rounded })
            .eq('id', customer.id);
          if (updateError) throw updateError;
          updated += 1;
        } catch (err) {
          console.error(`Error syncing distance for customer ${customer.id}:`, err);
          failed += 1;
        }
      }

      return c.json(
        { updated, failed, skipped: customers.length - updated - failed },
        200,
      );
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminCustomers;
