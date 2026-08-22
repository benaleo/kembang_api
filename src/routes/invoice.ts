import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { nestProducts } from '../lib/nest-products';
import { decryptInvoiceCode } from '../lib/crypto';

const invoice = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const invoiceProductSchema = z.object({
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

const invoiceDataSchema = z.object({
  id: z.number(),
  invoice: z.string().nullable(),
  date: z.string(),
  customer_name: z.string().nullable(),
  customer_phone: z.string().nullable(),
  customer_address: z.string().nullable(),
  cost_order: z.number(),
  cost_delivery: z.number(),
  total: z.number(),
  note: z.string().nullable(),
  billed_at: z.string().nullable(),
  products: z.array(invoiceProductSchema),
});

const queryParamSchema = z.object({
  code: z.string().openapi({ param: { name: 'code', in: 'query', required: true } }),
});

const errorResponse = z.object({ error: z.string() });

// Unauthenticated by design: the AES-encrypted `code` (only kembang_api can produce it,
// via INVOICE_SECRET_KEY) is itself the capability token — lets a printed/shared invoice
// link keep working without an active login session.
invoice.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Invoice'],
    request: { query: queryParamSchema },
    responses: {
      200: {
        description: 'Invoice detail',
        content: { 'application/json': { schema: z.object({ data: invoiceDataSchema }) } },
      },
      400: { description: 'Invalid code', content: { 'application/json': { schema: errorResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const { code } = c.req.valid('query');
      const payload = await decryptInvoiceCode<{ transaction_id: number; customer_id: number }>(
        c.env.INVOICE_SECRET_KEY,
        code,
      );
      if (!payload?.transaction_id || !payload?.customer_id) {
        return c.json({ error: 'Invalid or expired invoice code' }, 400);
      }

      const supabase = c.get('supabase') as any;

      const { data: t, error } = await supabase
        .from('transactions' as any)
        .select(
          `id, date, invoice, customer_id, customer_name, customer_phone, customer_address, cost_order, cost_delivery, note, billed_at,
          transaction_products (id, qty, parent_id, is_free, product:products (id, name, price))`,
        )
        .eq('id', payload.transaction_id)
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!t || t.customer_id !== payload.customer_id) {
        return c.json({ error: 'Invoice not found' }, 404);
      }

      return c.json({
        data: {
          id: t.id,
          invoice: t.invoice,
          date: t.date,
          customer_name: t.customer_name,
          customer_phone: t.customer_phone,
          customer_address: t.customer_address,
          cost_order: t.cost_order || 0,
          cost_delivery: t.cost_delivery || 0,
          total: (t.cost_order || 0) + (t.cost_delivery || 0),
          note: t.note,
          billed_at: t.billed_at || null,
          products: nestProducts(t.transaction_products || []),
        },
      }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default invoice;
