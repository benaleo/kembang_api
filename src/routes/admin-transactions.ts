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
  customer_geo: z.unknown().nullable(),
  customer_distances: z.unknown().nullable(),
  name_alter: z.string().nullable(),
  note: z.string().nullable(),
  note_route: z.string().nullable(),
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
  search: z.string().optional(),
  template: z.enum(['true', 'false']).optional(),
});

const idParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path', required: true }, example: '1' }),
});

const errorResponse = z.object({ error: z.string() });

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
      const { start_date, end_date, date, page, search, template } = c.req.valid('query');

      const pageSize = 20;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('transactions' as any)
        .select(
          `id, date, invoice, customer_id, customer_name, customer_phone, customer_address, customer_address_detail, customer_geo, customer_distances, name_alter, note, note_route, route, cost_delivery, cost_order, billed_at, template_id, created_at, updated_at,
          transaction_products (id, product_id, qty, parent_id, is_free, product:products (id, name, price))`,
          { count: 'exact' },
        )
        .order('route', { ascending: true })
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (date) {
        query = query.eq('date', date);
      } else if (start_date && end_date) {
        query = query.gte('date', start_date).lte('date', end_date);
      }

      if (search) {
        const safe = search.replace(/[,()]/g, ' ');
        query = query.or(`customer_name.ilike.%${safe}%,invoice.ilike.%${safe}%,name_alter.ilike.%${safe}%`);
      }

      if (template !== 'true') {
        query = query.is('template_id', null);
      }

      const { data, error, count } = await query;

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      const transactions = (data || []).map((t: any) => {
        const { transaction_products, ...rest } = t;
        return {
          ...rest,
          products: (transaction_products || []).map((tp: any) => ({
            id: tp.id,
            product_id: tp.product_id,
            qty: tp.qty,
            parent_id: tp.parent_id,
            is_free: tp.is_free,
            product: tp.product?.name || 'Unknown Product',
            price: tp.product?.price || 0,
          })),
        };
      });

      return c.json({ data: transactions, total: count ?? 0 });
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
      });
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
      });
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

      return c.json({ success: true });
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

      return c.json({ success: true });
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

      return c.json({ success: true });
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

      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminTransactions;
