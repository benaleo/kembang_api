import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { generateInvoice } from '../lib/invoice';

const adminTransactions = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const transactionProductSchema = z.object({
  product_id: z.number(),
  qty: z.number(),
  price: z.number(),
  subtotal: z.number().optional(),
  is_free: z.boolean().optional(),
  children: z
    .array(
      z.object({
        product_id: z.number(),
        qty: z.number(),
        price: z.number(),
        subtotal: z.number().optional(),
        is_free: z.boolean().optional(),
      }),
    )
    .optional(),
});

const createTransactionSchema = z.object({
  date: z.string(),
  customer_id: z.number().nullable().optional(),
  customer_name: z.string().optional().default(''),
  customer_phone: z.string().optional().default(''),
  customer_address: z.string().optional().default(''),
  name_alter: z.string(),
  note: z.string(),
  note_route: z.string(),
  template_id: z.number().nullable().optional(),
  customer_address_detail: z.string().nullable().optional(),
  customer_place: z.string().nullable().optional(),
  customer_geo: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  customer_distances: z.number().nullable().optional(),
  products: z.array(transactionProductSchema),
});

const transactionProductNodeSchema = z.object({
  id: z.number(),
  transaction_id: z.number(),
  product_id: z.number(),
  qty: z.number(),
  parent_id: z.number().nullable(),
  is_free: z.boolean(),
});

const transactionProductsCollectionSchema = z.object({
  edges: z.array(z.object({ node: transactionProductNodeSchema })),
});

const transactionSchema = z.object({
  id: z.number(),
  date: z.string(),
  invoice: z.string().nullable(),
  customer_id: z.number().nullable(),
  customer_name: z.string().nullable(),
  customer_phone: z.string().nullable(),
  customer_address: z.string().nullable(),
  customer_address_detail: z.string().nullable(),
  customer_place: z.string().nullable(),
  customer_geo: z.unknown().nullable(),
  customer_distances: z.unknown().nullable(),
  name_alter: z.string().nullable(),
  note: z.string().nullable(),
  note_route: z.string().nullable(),
  delivery_time_slot: z.string().nullable().optional(),
  delivery_time_manual: z.string().nullable().optional(),
  route: z.number().nullable(),
  cost_delivery: z.number().nullable(),
  cost_order: z.number().nullable(),
  billed_at: z.string().nullable(),
  template_id: z.number().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  transaction_productsCollection: transactionProductsCollectionSchema.optional(),
  transaction_products: z.array(z.unknown()).optional(),
});

const listQuerySchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  date: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
  template: z.enum(['true', 'false']).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const idParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path', required: true }, example: '1' }),
});

const errorResponse = z.object({ error: z.string() });
function formatTransactionIndex(transaction: any) {
  const customer = Array.isArray(transaction.customer) ? transaction.customer[0] : transaction.customer;
  const products = transaction.transaction_products || [];

  return {
    id: transaction.id,
    date: transaction.date,
    invoice: transaction.invoice,
    created_at: transaction.created_at ?? null,
    customer_id: transaction.customer_id,
    customer_name: transaction.customer_name || customer?.name || '',
    customer_registered_name: customer?.name || null,
    customer_address: transaction.customer_address || customer?.address || '',
    customer_address_note: customer?.address_note || '',
    customer_phone: transaction.customer_phone || customer?.phone || '',
    customer_place: transaction.customer_place || customer?.place || '',
    customer_distance: transaction.customer_distances ?? customer?.distance ?? 0,
    customer_distances: transaction.customer_distances ?? null,
    customer_address_detail: transaction.customer_address_detail ?? null,
    customer_geo: transaction.customer_geo ?? null,
    name_alter: transaction.name_alter || '',
    note: transaction.note || '',
    note_route: transaction.note_route || '',
    delivery_time_slot: transaction.delivery_time_slot || null,
    delivery_time_manual: transaction.delivery_time_manual || null,
    route: transaction.route || 0,
    billed_at: transaction.billed_at || null,
    cost_delivery: transaction.cost_delivery || 0,
    is_web_order: transaction.is_web_order ?? false,
    status: transaction.status ?? 'approved',
    products: products.map((tp: any) => ({
      id: tp.id,
      product_id: tp.product_id,
      product: tp.product?.name || 'Unknown Product',
      price: tp.product?.price || 0,
      qty: tp.qty || 0,
      parent_id: tp.parent_id || null,
      is_free: tp.is_free ?? false,
    })),
    total: products.reduce((sum: number, tp: any) => sum + (tp.qty || 0) * (tp.product?.price || 0), 0),
  };
}


// ---------------------------------------------------------------------------
// GET / — List transactions with products
// ---------------------------------------------------------------------------
adminTransactions.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Transactions'],
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: 'List transactions',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(transactionSchema), total: z.number() }),
          },
        },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { start_date, end_date, date, page, page_size, search, template, status } = c.req.valid('query');
      const from = (page - 1) * page_size;
      const to = from + page_size - 1;

      let query = supabase
        .from('transactions' as any)
        .select(
          `id, date, invoice, customer_id, customer_name, customer_phone, customer_address, customer_address_detail, customer_place, customer_geo, customer_distances, name_alter, note, note_route, delivery_time_slot, delivery_time_manual, route, cost_delivery, cost_order, billed_at, template_id, created_at, updated_at, is_web_order, status,
          customer:customers (name, address, address_note, distance, phone, place),
          transaction_products (id, product_id, qty, parent_id, is_free, product:products (id, name, price))`,
          { count: 'exact' },
        )
        .range(from, to);

      if (date) {
        query = query.eq('date', date);
      } else {
        if (start_date) query = query.gte('date', start_date);
        if (end_date) query = query.lte('date', end_date);
      }

      if (search) {
        const safe = search.replace(/[,()]/g, ' ');
        query = query.or(`customer_name.ilike.%${safe}%,invoice.ilike.%${safe}%,name_alter.ilike.%${safe}%`);
      }

      if (status) {
        query = query.eq('status', status);
      } else if (template !== 'true') {
        query = query.eq('status', 'approved');
      }

      if (template === 'true') {
        query = query.not('template_id', 'is', null);
      } else {
        query = query.is('template_id', null);
      }

      if (start_date && end_date && !date && !status) {
        query = query.order('date', { ascending: false });
      } else {
        query = query.order('route', { ascending: true }).order('updated_at', { ascending: false });
      }

      const { data, error, count } = await query;
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ data: (data || []).map(formatTransactionIndex), total: count ?? 0 }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /map — Delivery map data for a date (approved, route-ordered, no cap)
// ---------------------------------------------------------------------------
adminTransactions.openapi(
  createRoute({
    method: 'get',
    path: '/map',
    tags: ['Admin Transactions'],
    request: { query: z.object({ date: z.string() }) },
    responses: {
      200: {
        description: 'Delivery map data',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: z.number(),
                  customer_name: z.string(),
                  customer_geo: z.object({ lat: z.number(), lng: z.number() }).nullable(),
                  customer_address: z.string().nullable(),
                  customer_phone: z.string().nullable(),
                  customer_distances: z.number().nullable(),
                  route: z.number().nullable(),
                  name_alter: z.string().nullable(),
                  products: z.array(z.object({ code: z.string(), qty: z.number() })),
                }),
              ),
            }),
          },
        },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { date } = c.req.valid('query');

      const { data, error } = await supabase
        .from('transactions' as any)
        .select(
          `id, customer_name, customer_address, customer_phone, customer_distances, customer_geo, route, name_alter,
          customer:customers (name, address, phone),
          transaction_products (qty, product:products (code))`,
        )
        .eq('date', date)
        .eq('status', 'approved')
        .order('route', { ascending: true });

      if (error) return c.json({ error: error.message }, 500);

      const result = (data || []).map((transaction: any) => {
        const customer = Array.isArray(transaction.customer) ? transaction.customer[0] : transaction.customer;
        const rawGeo = transaction.customer_geo;
        const geo = typeof rawGeo === 'string' ? JSON.parse(rawGeo) : rawGeo;

        return {
          id: transaction.id,
          customer_name: transaction.customer_name || customer?.name || '',
          customer_geo: geo?.lat != null && geo?.lng != null ? { lat: geo.lat, lng: geo.lng } : null,
          customer_address: transaction.customer_address || customer?.address || null,
          customer_phone: transaction.customer_phone || customer?.phone || null,
          customer_distances: transaction.customer_distances != null ? Number(transaction.customer_distances) : null,
          route: transaction.route,
          name_alter: transaction.name_alter ?? null,
          products: (transaction.transaction_products || []).map((tp: any) => ({
            code: tp.product?.code ?? '',
            qty: tp.qty ?? 0,
          })),
        };
      });

      return c.json({ data: result }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// GET /calendar — Current month unbilled transactions grouped by date
// ---------------------------------------------------------------------------
adminTransactions.openapi(
  createRoute({
    method: 'get',
    path: '/calendar',
    tags: ['Admin Transactions'],
    responses: {
      200: {
        description: 'Calendar transactions',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  date: z.string(),
                  billed_at: z.string().nullable(),
                  transactions: z.object({ customer_name: z.array(z.string()) }),
                }),
              ),
            }),
          },
        },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      const { data, error } = await supabase
        .from('transactions' as any)
        .select('date, billed_at, customer:customers!inner (name)')
        .gte('date', startDate)
        .lte('date', endDate)
        .is('billed_at', null)
        .is('template_id', null)
        .order('date', { ascending: false });

      if (error) return c.json({ error: String(error.message) }, 500);

      const grouped = new Map<string, { date: string; billed_at: string | null; transactions: { customer_name: string[] } }>();
      for (const transaction of data || []) {
        const date = transaction.date;
        const customer = Array.isArray(transaction.customer) ? transaction.customer[0] : transaction.customer;
        const customerName = customer?.name;
        if (!date || !customerName) continue;

        if (!grouped.has(date)) {
          grouped.set(date, { date, billed_at: transaction.billed_at || null, transactions: { customer_name: [] } });
        }

        const names = grouped.get(date)!.transactions.customer_name;
        if (names.length < 3) names.push(customerName);
      }

      return c.json({ data: Array.from(grouped.values()) }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);


// ---------------------------------------------------------------------------
// GET /templates — List transaction templates
// ---------------------------------------------------------------------------
adminTransactions.openapi(
  createRoute({
    method: 'get',
    path: '/templates',
    tags: ['Admin Transactions'],
    responses: {
      200: {
        description: 'Transaction templates',
        content: { 'application/json': { schema: z.array(z.any()) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { data, error } = await supabase
        .from('transaction_templates' as any)
        .select('*')
        .order('created_at', { ascending: true });

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data || [], 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

const templateIdParamSchema = z.object({
  templateId: z.string().openapi({ param: { name: 'templateId', in: 'path', required: true }, example: '1' }),
});

// ---------------------------------------------------------------------------
// GET /templates/:templateId/preview — Preview transactions inside a template
// ---------------------------------------------------------------------------
adminTransactions.openapi(
  createRoute({
    method: 'get',
    path: '/templates/{templateId}/preview',
    tags: ['Admin Transactions'],
    request: { params: templateIdParamSchema },
    responses: {
      200: {
        description: 'Template import preview rows',
        content: { 'application/json': { schema: z.array(z.any()) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const templateId = Number(c.req.valid('param').templateId);

      const { data: templateTransactions, error } = await supabase
        .from('transactions' as any)
        .select(
          `*,
          transaction_products(
            *,
            product:products(name)
          )`,
        )
        .eq('template_id', templateId)
        .order('route', { ascending: true });

      if (error) return c.json({ error: error.message }, 500);
      if (!templateTransactions?.length) return c.json([], 200);

      const customerIds = Array.from(
        new Set(
          templateTransactions
            .map((transaction: any) => transaction.customer_id)
            .filter(Boolean),
        ),
      );

      const lastOrderByCustomerId = new Map<number, string>();

      if (customerIds.length) {
        const { data: lastOrders, error: lastOrderError } = await supabase
          .from('transactions' as any)
          .select('customer_id, date')
          .in('customer_id', customerIds)
          .is('template_id', null)
          .order('date', { ascending: false });

        if (lastOrderError) return c.json({ error: lastOrderError.message }, 500);

        for (const order of lastOrders || []) {
          if (order.customer_id && order.date && !lastOrderByCustomerId.has(order.customer_id)) {
            lastOrderByCustomerId.set(order.customer_id, order.date);
          }
        }
      }

      return c.json(
        (templateTransactions || []).map((transaction: any) => ({
          ...transaction,
          last_order_date: lastOrderByCustomerId.get(transaction.customer_id) ?? null,
          product_summary: (transaction.transaction_products || [])
            .map((product: any) => `${product.qty || 0}x ${product.product?.name || 'Unknown Product'}`)
            .join(', '),
        })),
      );
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /templates/:templateId/import — Import selected template transactions
// ---------------------------------------------------------------------------
adminTransactions.openapi(
  createRoute({
    method: 'post',
    path: '/templates/{templateId}/import',
    tags: ['Admin Transactions'],
    request: {
      params: templateIdParamSchema,
      body: {
        content: {
          'application/json': {
            schema: z.object({
              target_date: z.string(),
              selected_transaction_ids: z.array(z.number()).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Imported transactions',
        content: { 'application/json': { schema: z.array(z.any()) } },
      },
      400: { description: 'Invalid request', content: { 'application/json': { schema: errorResponse } } },
      404: { description: 'Template transactions not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const templateId = Number(c.req.valid('param').templateId);
      const { target_date, selected_transaction_ids } = c.req.valid('json');

      if (selected_transaction_ids && selected_transaction_ids.length === 0) {
        return c.json({ error: 'No transactions selected' }, 400);
      }

      let query = supabase
        .from('transactions' as any)
        .select('*, transaction_products(*)')
        .eq('template_id', templateId)
        .order('route', { ascending: true });

      if (selected_transaction_ids) {
        query = query.in('id', selected_transaction_ids);
      }

      const { data: templateTransactions, error: fetchError } = await query;
      if (fetchError) return c.json({ error: fetchError.message }, 500);
      if (!templateTransactions?.length) return c.json({ error: 'No transactions found in template' }, 404);

      const insertedTransactions = [];

      for (const templateTransaction of templateTransactions) {
        const { id, created_at, updated_at, transaction_products, ...transactionData } = templateTransaction;
        const { data: sequenceData, error: sequenceError } = await supabase
          .from('transaction_sequence_view' as any)
          .select('max_sequence')
          .single();

        if (sequenceError) return c.json({ error: sequenceError.message }, 500);

        const sequence = sequenceData?.max_sequence ? sequenceData.max_sequence + 1 : 1;
        const invoice = generateInvoice(sequence, target_date, 'KEMBANGSELADANG');

        const { data: insertedTransaction, error: insertError } = await supabase
          .from('transactions' as any)
          .insert({
            ...transactionData,
            template_id: null,
            date: target_date,
            invoice,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) return c.json({ error: insertError.message }, 500);

        if (transaction_products?.length) {
          const newProducts = transaction_products.map((product: any) => {
            const { id: productId, transaction_id, ts, ...productData } = product;
            return {
              ...productData,
              transaction_id: insertedTransaction.id,
              ts: new Date().toISOString(),
            };
          });

          const { error: productError } = await supabase
            .from('transaction_products' as any)
            .insert(newProducts);

          if (productError) return c.json({ error: productError.message }, 500);
        }

        insertedTransactions.push(insertedTransaction);
      }

      return c.json(insertedTransactions, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id — Get single transaction with products
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admin Transactions'],
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Transaction detail',
        content: { 'application/json': { schema: z.object({ data: transactionSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');

      const { data, error } = await supabase
        .from('transactions' as any)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) return c.json({ error: error.message }, 500);
      if (!data) return c.json({ error: 'Transaction not found' }, 404);

      const { data: tps, error: tpError } = await supabase
        .from('transaction_products' as any)
        .select('id, transaction_id, product_id, qty, parent_id, is_free')
        .eq('transaction_id', id)
        .order('id', { ascending: true });

      if (tpError) return c.json({ error: tpError.message }, 500);

      return c.json({
        data: {
          ...(data as any),
          transaction_productsCollection: {
            edges: (tps || []).map((tp: any) => ({ node: tp })),
          },
        },
      }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// POST / — Create transaction + invoice + products
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Transactions'],
    request: {
      body: { content: { 'application/json': { schema: createTransactionSchema } } },
    },
    responses: {
      201: {
        description: 'Transaction created',
        content: { 'application/json': { schema: z.object({ data: transactionSchema }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const body = c.req.valid('json');

      // 1. Generate invoice from sequence view
      const { data: sequenceData, error: seqError } = await supabase
        .from('transaction_sequence_view' as any)
        .select('max_sequence')
        .maybeSingle();

      if (seqError) return c.json({ error: seqError.message }, 500);
      const maxSeq = (sequenceData as any)?.max_sequence;
      const sequence = maxSeq ? maxSeq + 1 : 1;
      const invoice = generateInvoice(sequence, body.date, 'KEMBANGSELADANG');

      // 2. Insert transaction
      const { products, ...transactionPayload } = body;
      const { data: createdTransaction, error: txError } = (await supabase
        .from('transactions' as any)
        .insert([
          {
            ...transactionPayload,
            customer_id: transactionPayload.customer_id || null,
            template_id: transactionPayload.template_id || null,
            customer_geo:
              transactionPayload.customer_geo != null
                ? JSON.stringify(transactionPayload.customer_geo)
                : null,
            customer_distances:
              transactionPayload.customer_distances != null
                ? String(transactionPayload.customer_distances)
                : null,
            invoice,
          },
        ])
        .select()
        .single()) as { data: any; error: any };

      if (txError) return c.json({ error: txError.message }, 500);
      if (!createdTransaction?.id) return c.json({ error: 'Failed to create transaction' }, 500);

      // 3. Insert products
      if (products && products.length > 0) {
        // 3a. Insert level-1 (parent) products first
        const { data: parentRows, error: parentInsertError } = (await supabase
          .from('transaction_products' as any)
          .insert(
            products.map((p) => ({
              transaction_id: createdTransaction.id,
              product_id: p.product_id,
              qty: p.qty,
              is_free: false,
              parent_id: null,
            })),
          )
          .select('id, product_id')) as { data: any; error: any };

        if (parentInsertError) return c.json({ error: parentInsertError.message }, 500);

        // 3b. Insert level-2 children with parent_id
        const childrenObjects: Array<{
          transaction_id: number;
          product_id: number;
          qty: number;
          is_free: boolean;
          parent_id: number;
        }> = [];

        products.forEach((product, index) => {
          const parentId = parentRows?.[index]?.id;
          if (parentId && product.children && product.children.length > 0) {
            for (const child of product.children) {
              childrenObjects.push({
                transaction_id: createdTransaction.id,
                product_id: child.product_id,
                qty: child.qty ?? 1,
                is_free: child.is_free ?? true,
                parent_id: parentId,
              });
            }
          }
        });

        if (childrenObjects.length > 0) {
          const { error: childInsertError } = await supabase
            .from('transaction_products' as any)
            .insert(childrenObjects);
          if (childInsertError) return c.json({ error: childInsertError.message }, 500);
        }

        // 3c. cost_order = sum of (price * qty) for billable items only
        const billableItems = products.flatMap((product) => [
          { product_id: product.product_id, qty: product.qty },
          ...(product.children || [])
            .filter((child) => !child.is_free)
            .map((child) => ({ product_id: child.product_id, qty: child.qty ?? 1 })),
        ]);

        const allProductIds = [...new Set(billableItems.map((item) => item.product_id))];
        const { data: productData, error: productError } = await supabase
          .from('products')
          .select('id, price')
          .in('id', allProductIds);

        if (productError) return c.json({ error: productError.message }, 500);

        const cost_order = billableItems.reduce((total, item) => {
          const pd = productData?.find((p: any) => p.id === item.product_id);
          return total + (pd?.price || 0) * item.qty;
        }, 0);

        if (cost_order !== 0) {
          await (supabase.from('transactions') as any).update({ cost_order }).eq('id', createdTransaction.id);
        }
      }

      // Return created transaction with products collection
      const { data: fullTransaction } = await supabase
        .from('transactions' as any)
        .select('*')
        .eq('id', createdTransaction.id)
        .single();

      const { data: tps } = await supabase
        .from('transaction_products' as any)
        .select('id, transaction_id, product_id, qty, parent_id, is_free')
        .eq('transaction_id', createdTransaction.id)
        .order('id', { ascending: true });

      return c.json(
        {
          data: {
            ...(fullTransaction || createdTransaction),
            transaction_productsCollection: {
              edges: (tps || []).map((tp: any) => ({ node: tp })),
            },
          },
        },
        201,
      );
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /:id — Update transaction (+ delete/reinsert products)
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Transactions'],
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: createTransactionSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Transaction updated',
        content: { 'application/json': { schema: z.object({ data: transactionSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const { products, ...transactionUpdates } = body;

      // Build update object with geo/distances serialization
      const updateFields: Record<string, unknown> = { ...transactionUpdates };
      if (transactionUpdates.customer_geo !== undefined) {
        updateFields.customer_geo =
          transactionUpdates.customer_geo != null
            ? JSON.stringify(transactionUpdates.customer_geo)
            : null;
      }
      if (transactionUpdates.customer_distances !== undefined) {
        updateFields.customer_distances =
          transactionUpdates.customer_distances != null
            ? String(transactionUpdates.customer_distances)
            : null;
      }

      const { data: updatedTransaction, error: txError } = await supabase
        .from('transactions' as any)
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (txError) return c.json({ error: txError.message }, 500);
      if (!updatedTransaction) return c.json({ error: 'Transaction not found' }, 404);

      // Delete + reinsert products if provided
      if (products && products.length > 0) {
        await (supabase.from('transaction_products') as any).delete().eq('transaction_id', id);

        // Insert parents first
        const { data: parentRows, error: parentInsertError } = await supabase
          .from('transaction_products' as any)
          .insert(
            products.map((p) => ({
              transaction_id: Number(id),
              product_id: p.product_id,
              qty: p.qty,
              is_free: false,
              parent_id: null,
            })),
          )
          .select('id, product_id');

        if (parentInsertError) return c.json({ error: parentInsertError.message }, 500);

        // Insert children
        const childrenObjects: Array<{
          transaction_id: number;
          product_id: number;
          qty: number;
          is_free: boolean;
          parent_id: number;
        }> = [];

        products.forEach((product, index) => {
          const parentId = parentRows?.[index]?.id;
          if (parentId && product.children && product.children.length > 0) {
            for (const child of product.children) {
              childrenObjects.push({
                transaction_id: Number(id),
                product_id: child.product_id,
                qty: child.qty ?? 1,
                is_free: child.is_free ?? true,
                parent_id: parentId,
              });
            }
          }
        });

        if (childrenObjects.length > 0) {
          const { error: childInsertError } = await supabase
            .from('transaction_products' as any)
            .insert(childrenObjects);
          if (childInsertError) return c.json({ error: childInsertError.message }, 500);
        }

        // cost_order
        const billableItems = products.flatMap((product) => [
          { product_id: product.product_id, qty: product.qty },
          ...(product.children || [])
            .filter((child) => !child.is_free)
            .map((child) => ({ product_id: child.product_id, qty: child.qty ?? 1 })),
        ]);

        const allProductIds = [...new Set(billableItems.map((item) => item.product_id))];
        const { data: productData, error: productError } = await supabase
          .from('products')
          .select('id, price')
          .in('id', allProductIds);

        if (productError) return c.json({ error: productError.message }, 500);

        const cost_order = billableItems.reduce((total, item) => {
          const pd = productData?.find((p: any) => p.id === item.product_id);
          return total + (pd?.price || 0) * item.qty;
        }, 0);

        if (cost_order !== 0) {
          await (supabase.from('transactions') as any).update({ cost_order }).eq('id', id);
        }
      }

      // Return updated transaction with products collection
      const { data: tps } = await supabase
        .from('transaction_products' as any)
        .select('id, transaction_id, product_id, qty, parent_id, is_free')
        .eq('transaction_id', id)
        .order('id', { ascending: true });

      return c.json({
        data: {
          ...updatedTransaction,
          transaction_productsCollection: {
            edges: (tps || []).map((tp: any) => ({ node: tp })),
          },
        },
      }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /:id — Delete transaction products + transaction
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin Transactions'],
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Transaction deleted',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');

      await (supabase.from('transaction_products') as any).delete().eq('transaction_id', id);

      const { error } = await (supabase.from('transactions') as any).delete().eq('id', id);
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ success: true }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /:id/route — Update route
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/route',
    tags: ['Admin Transactions'],
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: z.object({ route: z.number() }) } } },
    },
    responses: {
      200: {
        description: 'Route updated',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');
      const { route } = c.req.valid('json');

      const { error } = await (supabase.from('transactions') as any).update({ route }).eq('id', id);
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ success: true }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /:id/distance — Update customer distance on a transaction
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/distance',
    tags: ['Admin Transactions'],
    request: {
      params: idParamSchema,
      body: {
        content: {
          'application/json': { schema: z.object({ customer_distances: z.number().nullable() }) },
        },
      },
    },
    responses: {
      200: {
        description: 'Distance updated',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');
      const { customer_distances } = c.req.valid('json');

      const { error } = await (supabase.from('transactions') as any)
        .update({ customer_distances })
        .eq('id', id);
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ success: true }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /:id/delivery-cost — Update delivery cost
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/delivery-cost',
    tags: ['Admin Transactions'],
    request: {
      params: idParamSchema,
      body: {
        content: { 'application/json': { schema: z.object({ cost_delivery: z.number() }) } },
      },
    },
    responses: {
      200: {
        description: 'Delivery cost updated',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');
      const { cost_delivery } = c.req.valid('json');

      const { error } = await supabase
        .from('transactions' as any)
        .update({ cost_delivery })
        .eq('id', id);
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ success: true }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /:id/status — Approve or reject a web order
// ---------------------------------------------------------------------------

adminTransactions.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/status',
    tags: ['Admin Transactions'],
    request: {
      params: idParamSchema,
      body: {
        content: { 'application/json': { schema: z.object({ status: z.enum(['approved', 'rejected']) }) } },
      },
    },
    responses: {
      200: {
        description: 'Status updated',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const { id } = c.req.valid('param');
      const { status } = c.req.valid('json');

      const { error } = await supabase
        .from('transactions' as any)
        .update({ status })
        .eq('id', id);
      if (error) return c.json({ error: error.message }, 500);

      return c.json({ success: true }, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminTransactions;
