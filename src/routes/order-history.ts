import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { nestProducts } from '../lib/nest-products';
import { encryptInvoiceCode } from '../lib/crypto';

const orderHistory = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const orderHistoryProductSchema = z.object({
  product_id: z.number().nullable(),
  name: z.string(),
  price: z.number(),
  qty: z.number(),
  is_free: z.boolean(),
  children: z.array(
    z.object({
      product_id: z.number().nullable(),
      name: z.string(),
      price: z.number(),
      qty: z.number(),
      is_free: z.boolean(),
    }),
  ),
});

const orderHistoryItemSchema = z.object({
  id: z.number(),
  date: z.string(),
  invoice: z.string().nullable(),
  invoice_code: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  is_web_order: z.boolean(),
  total: z.number(),
  note: z.string().nullable(),
  created_at: z.string().nullable(),
  products: z.array(orderHistoryProductSchema),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const errorResponse = z.object({ error: z.string() });

orderHistory.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['User Order History'],
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: "List current user's order history",
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(orderHistoryItemSchema),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
              totalPages: z.number(),
            }),
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const userId = c.get('userId');
      const { page, status, start_date, end_date } = c.req.valid('query');
      const pageSize = 5;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (!customer?.id) {
        return c.json({ data: [], total: 0, page, pageSize, totalPages: 0 }, 200);
      }

      let query = supabase
        .from('transactions' as any)
        .select(
          `id, date, invoice, status, is_web_order, cost_order, cost_delivery, note, created_at,
          transaction_products (id, qty, parent_id, is_free, product:products (id, name, price))`,
          { count: 'exact' },
        )
        .eq('customer_id', customer.id)
        .is('template_id', null)
        .order('date', { ascending: false })
        .range(from, to);

      if (status) query = query.eq('status', status);
      if (start_date && end_date) query = query.gte('date', start_date).lte('date', end_date);

      const { data, error, count } = await query;
      if (error) return c.json({ error: error.message }, 500);

      const orders = await Promise.all(
        (data || []).map(async (t: any) => ({
          id: t.id,
          date: t.date,
          invoice: t.invoice,
          invoice_code: await encryptInvoiceCode(c.env.INVOICE_SECRET_KEY, {
            transaction_id: t.id,
            customer_id: customer.id,
          }),
          status: t.status ?? 'approved',
          is_web_order: t.is_web_order ?? false,
          total: (t.cost_order || 0) + (t.cost_delivery || 0),
          note: t.note,
          created_at: t.created_at,
          products: nestProducts(t.transaction_products || []),
        })),
      );

      const total = count ?? 0;
      return c.json({ data: orders, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default orderHistory;
