import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { generateInvoice } from '../lib/invoice';
import { getDistanceKm } from '../lib/gomaps';

const checkout = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const checkoutProductSchema = z.object({
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

const checkoutBodySchema = z.object({
  address_id: z.number().optional(),
  recipient_name: z.string().optional(),
  recipient_phone: z.string().optional(),
  recipient_address: z.string().optional(),
  recipient_address_detail: z.string().nullable().optional(),
  recipient_geo: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
  note: z.string(),
  products: z.array(checkoutProductSchema),
  delivery_date: z.string(),
  delivery_time_slot: z.enum(['06:00-07:00', '07:00-09:00', '09:00-12:00', 'above-12:00', 'manual']),
  delivery_time_manual: z.string().nullable().optional(),
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
  is_web_order: z.boolean().optional(),
  status: z.string().optional(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  transaction_productsCollection: transactionProductsCollectionSchema.optional(),
});

const errorResponse = z.object({ error: z.string() });

// ---------------------------------------------------------------------------
// POST / — Customer-scoped checkout: create transaction + invoice + products
// ---------------------------------------------------------------------------

checkout.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Checkout'],
    request: {
      body: { content: { 'application/json': { schema: checkoutBodySchema } } },
    },
    responses: {
      201: {
        description: 'Order created',
        content: { 'application/json': { schema: z.object({ data: transactionSchema }) } },
      },
      400: { description: 'Bad request', content: { 'application/json': { schema: errorResponse } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponse } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorResponse } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorResponse } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const userId = c.get('userId');
      const body = c.req.valid('json');

      if (body.delivery_time_slot === 'manual' && !body.delivery_time_manual) {
        return c.json({ error: 'delivery_time_manual wajib diisi untuk slot manual' }, 400);
      }

      // 1. Resolve customer_id from userId
      let customerId: number;
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (existingCustomer?.id) {
        customerId = existingCustomer.id;
      } else {
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert([{ user_id: userId, name: body.recipient_name || '', phone: body.recipient_phone || null }])
          .select('id')
          .single();
        if (customerError) return c.json({ error: customerError.message }, 500);
        customerId = newCustomer.id;
      }

      // 2. Resolve address data
      let recipientName: string;
      let recipientPhone: string;
      let recipientAddress: string;
      let recipientAddressDetail: string | null = null;
      let recipientGeo: { lat: number; lng: number } | null = null;
      let recipientDistances: number | null = null;
      let usedInlineAddress = false;

      if (body.address_id) {
        const { data: address, error: addressError } = await supabase
          .from('customer_addresses')
          .select('*')
          .eq('id', body.address_id)
          .maybeSingle();
        if (addressError) return c.json({ error: addressError.message }, 500);
        if (!address) return c.json({ error: 'Address not found' }, 404);
        if (address.user_id !== userId) return c.json({ error: 'Forbidden' }, 403);

        recipientName = address.recipient_name;
        recipientPhone = address.recipient_phone;
        recipientAddress = address.recipient_address;
        recipientAddressDetail = address.recipient_address_detail ?? null;
        recipientGeo = address.recipient_geo ?? null;
        recipientDistances = address.recipient_distances ?? null;
      } else {
        if (!body.recipient_address) return c.json({ error: 'recipient_address is required' }, 400);
        recipientName = body.recipient_name || '';
        recipientPhone = body.recipient_phone || '';
        recipientAddress = body.recipient_address;
        recipientAddressDetail = body.recipient_address_detail ?? null;
        recipientGeo = body.recipient_geo ?? null;
        usedInlineAddress = true;
      }

      if (recipientGeo?.lat !== undefined && recipientGeo?.lng !== undefined) {
        try {
          recipientDistances = await getDistanceKm(recipientGeo.lat, recipientGeo.lng);
        } catch (err) {
          console.error('Failed to compute distance via OSRM:', err);
        }
      }

      // 2b. Best-effort: persist inline address to customer_addresses
      if (usedInlineAddress && recipientName && recipientPhone && recipientAddress) {
        try {
          const { count } = await supabase
            .from('customer_addresses')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);
          const isDefault = count === 0;

          await supabase.from('customer_addresses').insert([
            {
              user_id: userId,
              customer_id: customerId,
              label: null,
              recipient_name: recipientName,
              recipient_phone: recipientPhone,
              recipient_address: recipientAddress,
              recipient_address_detail: recipientAddressDetail,
              recipient_geo: recipientGeo ?? null,
              recipient_distances: recipientDistances ?? 0,
              is_default: isDefault,
            },
          ]);
        } catch (err) {
          console.error('Failed to persist inline address to customer_addresses:', err);
        }
      }

      // 3. Generate invoice from sequence view
      const date = body.delivery_date;
      const { data: sequenceData, error: seqError } = await supabase
        .from('transaction_sequence_view' as any)
        .select('max_sequence')
        .maybeSingle();
      if (seqError) return c.json({ error: seqError.message }, 500);
      const maxSeq = (sequenceData as any)?.max_sequence;
      const sequence = maxSeq ? maxSeq + 1 : 1;
      const invoice = generateInvoice(sequence, date, 'KEMBANGSELADANG');
      const deliverySurcharge = body.delivery_time_slot === '06:00-07:00' ? 3000 : 0;

      // 4. Insert transaction
      const { data: createdTransaction, error: txError } = (await supabase
        .from('transactions' as any)
        .insert([
          {
            date,
            customer_id: customerId,
            customer_name: recipientName,
            customer_phone: recipientPhone,
            customer_address: recipientAddress,
            customer_address_detail: recipientAddressDetail,
            customer_geo: recipientGeo != null ? JSON.stringify(recipientGeo) : null,
            customer_distances: recipientDistances != null ? String(recipientDistances) : null,
            note: body.note,
            note_route: '',
            name_alter: '',
            template_id: null,
            route: null,
            cost_delivery: 0,
            invoice,
            is_web_order: true,
            status: 'pending',
            delivery_time_slot: body.delivery_time_slot,
            delivery_time_manual: body.delivery_time_slot === 'manual' ? body.delivery_time_manual : null,
            delivery_surcharge: deliverySurcharge,
          },
        ])
        .select()
        .single()) as { data: any; error: any };
      if (txError) return c.json({ error: txError.message }, 500);
      if (!createdTransaction?.id) return c.json({ error: 'Failed to create transaction' }, 500);

      // 5. Insert products
      const products = body.products;
      if (products && products.length > 0) {
        // 5a. Insert level-1 (parent) products first
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

        // 5b. Insert level-2 children with parent_id
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

        // 5c. cost_order = sum of (price * qty) for billable items only
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
        }, deliverySurcharge);
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

export default checkout;
