import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminCustomerOptions = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminCustomerOptions.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Customer Options'],
    responses: {
      200: {
        description: 'List customer options',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: z.number(),
                  name: z.string(),
                  phone: z.string().nullable(),
                  address: z.string().nullable(),
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

      const { data: customers, error } = await supabase
        .from('customers')
        .select('id, name, phone')
        .order('name', { ascending: true });

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      // supabase client tidak punya generated types, bentuk row di-cast manual.
      const list = (customers || []) as Array<{ id: number; name: string; phone: string | null }>;

      // alamat default diambil dari customer_addresses (is_default=true).
      // customer_addresses tidak punya FK ke customers, jadi merge manual per customer_id.
      const defaultByCustomer = new Map<number, string | null>();
      if (list.length > 0) {
        const ids = list.map((row) => row.id);
        const { data: addresses } = await supabase
          .from('customer_addresses')
          .select('customer_id, recipient_address')
          .in('customer_id', ids)
          .eq('is_default', true);

        for (const addr of (addresses || []) as Array<{ customer_id: number; recipient_address: string | null }>) {
          if (!defaultByCustomer.has(addr.customer_id)) {
            defaultByCustomer.set(addr.customer_id, addr.recipient_address);
          }
        }
      }

      const data = list.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone ?? null,
        address: defaultByCustomer.get(row.id) ?? null,
      }));

      return c.json({ data }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminCustomerOptions;
