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

      // PostgREST default cap 1000 rows/request, jadi harus di-paginate biar dapet semua.
      const PAGE_SIZE = 1000;
      const list: Array<{ id: number; name: string; phone: string | null }> = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error } = await supabase
          .from('customers')
          .select('id, name, phone')
          .order('name', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) {
          return c.json({ error: error.message }, 500);
        }

        const rows = (page || []) as Array<{ id: number; name: string; phone: string | null }>;
        list.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }

      // alamat default diambil dari customer_addresses (is_default=true).
      // customer_addresses tidak punya FK ke customers, jadi merge manual per customer_id.
      const defaultByCustomer = new Map<number, string | null>();
      for (let i = 0; i < list.length; i += PAGE_SIZE) {
        const ids = list.slice(i, i + PAGE_SIZE).map((row) => row.id);
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
