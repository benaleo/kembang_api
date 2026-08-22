import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminInvoices = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// Interpret a search keyword as a date or period so users can search by date
// from the same search box. Supported: dd/mm/yyyy, yyyy-mm-dd (single day),
// mm/yyyy, yyyy-mm (whole month), and "<date> - <date>" ranges.
const parseSingleDate = (kw: string): string | null => {
  let m = kw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = kw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
};

const parseDatePeriod = (kw: string): { start: string; end: string } | null => {
  // Range: "13/08/2025 - 20/08/2025"
  const parts = kw.split(/\s*[-–]\s+|\s+s\/?d\s+/i);
  if (parts.length === 2) {
    const start = parseSingleDate(parts[0].trim());
    const end = parseSingleDate(parts[1].trim());
    if (start && end) return { start, end };
  }

  const single = parseSingleDate(kw);
  if (single) return { start: single, end: single };

  // Whole month: mm/yyyy or yyyy-mm
  let m = kw.match(/^(\d{1,2})[/-](\d{4})$/);
  let year: number | null = null;
  let month: number | null = null;
  if (m) {
    month = Number(m[1]);
    year = Number(m[2]);
  } else {
    m = kw.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]);
    }
  }
  if (year && month && month >= 1 && month <= 12) {
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${lastDay}` };
  }

  return null;
};

adminInvoices.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Invoices'],
    request: {
      query: z.object({
        keyword: z.string().optional(),
        page: z.string().optional(),
        page_size: z.string().optional(),
        date_start: z.string().optional(),
        date_end: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Invoice datatable',
        content: {
          'application/json': {
            schema: z.object({ data: z.array(z.any()), total: z.number() }),
          },
        },
      },
      400: {
        description: 'Query error',
        content: {
          'application/json': {
            schema: z.object({ error: z.string(), data: z.array(z.any()), total: z.number() }),
          },
        },
      },
      500: {
        description: 'Server error',
        content: {
          'application/json': {
            schema: z.object({ error: z.string(), data: z.array(z.any()), total: z.number() }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase') as any;

    try {
      const p = c.req.query();

      const keyword = String(p.keyword ?? '').trim();
      const page = Math.max(1, Number(p.page) || 1);
      const pageSize = Math.min(10000, Math.max(1, Number(p.page_size) || 10));
      const dateStart = p.date_start ? String(p.date_start) : undefined;
      const dateEnd = p.date_end ? String(p.date_end) : undefined;

      const offset = (page - 1) * pageSize;

      let query = supabase
        .from('transactions')
        .select(
          `
          id,
          invoice,
          date,
          note,
          route,
          customer_id,
          customer_name,
          customer_phone,
          customer_address,
          cost_delivery,
          billed_at,
          created_at,
          updated_at,
          customer:customers (
            id,
            name,
            phone,
            address
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
        .is('template_id', null)
        .order('date', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (keyword) {
        const period = parseDatePeriod(keyword);
        if (period) {
          // Keyword looks like a date/period -> filter by transaction date
          query = query.gte('date', period.start).lte('date', period.end);
        } else {
          // The displayed name falls back to customers.name when the
          // transaction's own customer_name is empty, so the search has to
          // cover both. or() can't span joined tables -> resolve matching
          // customer ids first, then OR them in as customer_id.in.(...)
          const { data: matchedCustomers } = await supabase
            .from('customers')
            .select('id')
            .ilike('name', `%${keyword}%`)
            .limit(500);

          const orParts = [
            `customer_name.ilike.%${keyword}%`,
            `customer_address.ilike.%${keyword}%`,
            `invoice.ilike.%${keyword}%`,
          ];
          if (matchedCustomers && matchedCustomers.length > 0) {
            orParts.push(`customer_id.in.(${matchedCustomers.map((c: any) => c.id).join(',')})`);
          }
          query = query.or(orParts.join(','));
        }
      }
      if (dateStart) query = query.gte('date', dateStart);
      if (dateEnd) query = query.lte('date', dateEnd);

      const { data, count, error } = await query;

      if (error) {
        console.error('invoice-datatable query error:', error);
        return c.json({ error: error.message, data: [], total: 0 }, 400);
      }

      const formatted = (data ?? []).map((t: any) => {
        const customer = Array.isArray(t.customer) ? t.customer[0] : t.customer;
        const products = (t.transaction_products ?? []).map((tp: any) => ({
          product: tp.product?.name || 'Unknown Product',
          price: tp.product?.price || 0,
          qty: tp.qty || 0,
        }));
        const total = products.reduce((sum: number, item: any) => sum + item.price * item.qty, 0);

        return {
          id: t.id,
          date: t.date,
          customer_id: customer?.id || 0,
          customer_name: t.customer_name || customer?.name || '',
          customer_phone: t.customer_phone || customer?.phone || '',
          customer_address: t.customer_address || customer?.address || '',
          note: t.note || '',
          route: t.route || 0,
          products,
          total,
          invoice: t.invoice || '',
          cost_delivery: t.cost_delivery || 0,
          billed_at: t.billed_at || null,
          created_at: t.created_at || new Date().toISOString(),
          updated_at: t.updated_at || new Date().toISOString(),
        };
      });

      return c.json({ data: formatted, total: count ?? 0 }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return c.json({ error: message, data: [], total: 0 }, 500);
    }
  },
);

export default adminInvoices;
