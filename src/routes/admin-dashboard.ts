import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminDashboard = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// PostgREST caps a single select at 1000 rows — page through until exhausted
// so aggregations stay correct no matter how many transactions exist.
const PAGE_SIZE = 1000;
async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

type IncomeRow = { date: string | null; cost_order: number | null; billed_at: string | null };
type DeliveryRow = { date: string | null; total: number | null; driver_name: string | null };

adminDashboard.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Dashboard'],
    responses: {
      200: {
        description: 'Dashboard aggregates',
        content: {
          'application/json': {
            schema: z.object({
              income: z.array(z.object({ date: z.string(), total: z.number(), dibayar: z.number() })),
              driver_monthly: z.array(
                z.object({
                  month: z.string(),
                  drivers: z.array(z.object({ driver_name: z.string(), total: z.number() })),
                }),
              ),
              driver_today: z.array(z.object({ driver_name: z.string(), total: z.number() })),
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
    const supabase = c.get('supabase') as any;

    try {
      // Range: first day of previous month → last day of current month (UTC)
      const now = new Date();
      const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const toDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      );
      const today = now.toISOString().split('T')[0];

      const [incomeRows, deliveryRows, todayRows] = await Promise.all([
        fetchAllRows<IncomeRow>(() =>
          supabase
            .from('transactions')
            .select('date, cost_order, billed_at')
            .gte('date', fromDate.toISOString())
            .lte('date', toDate.toISOString())
            .order('id', { ascending: true }),
        ),
        fetchAllRows<DeliveryRow>(() =>
          supabase
            .from('transaction_deliveries')
            .select('date, total, driver_name')
            .gte('date', fromDate.toISOString())
            .lte('date', toDate.toISOString())
            .order('id', { ascending: true }),
        ),
        fetchAllRows<DeliveryRow>(() =>
          supabase
            .from('transaction_deliveries')
            .select('date, total, driver_name')
            .eq('date', today)
            .order('id', { ascending: true }),
        ),
      ]);

      // --- Income: aggregate per day, then fill every day in range ---
      const dailyData = new Map<string, { total: number; dibayar: number }>();
      for (const t of incomeRows) {
        if (!t.date) continue;
        const dateString = t.date.split('T')[0];
        const entry = dailyData.get(dateString) ?? { total: 0, dibayar: 0 };
        entry.total += t.cost_order || 0;
        if (t.billed_at) entry.dibayar += t.cost_order || 0;
        dailyData.set(dateString, entry);
      }

      const income: { date: string; total: number; dibayar: number }[] = [];
      for (const d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
        const dateString = d.toISOString().split('T')[0];
        const dayData = dailyData.get(dateString) ?? { total: 0, dibayar: 0 };
        income.push({ date: dateString, total: dayData.total, dibayar: dayData.dibayar });
      }

      // --- Driver: aggregate per month (YYYY-MM) per driver ---
      const monthlyData = new Map<string, Map<string, number>>();
      for (const t of deliveryRows) {
        if (!t.date || !t.driver_name) continue;
        const monthKey = t.date.split('T')[0].slice(0, 7);
        const driverData = monthlyData.get(monthKey) ?? new Map<string, number>();
        driverData.set(t.driver_name, (driverData.get(t.driver_name) || 0) + (t.total || 0));
        monthlyData.set(monthKey, driverData);
      }

      const driver_monthly = [...monthlyData.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, drivers]) => ({
          month,
          drivers: [...drivers.entries()].map(([driver_name, total]) => ({ driver_name, total })),
        }));

      // --- Driver today: aggregate per driver ---
      const todayTotals = new Map<string, number>();
      for (const t of todayRows) {
        if (!t.driver_name) continue;
        todayTotals.set(t.driver_name, (todayTotals.get(t.driver_name) || 0) + (t.total || 0));
      }
      const driver_today = [...todayTotals.entries()].map(([driver_name, total]) => ({
        driver_name,
        total,
      }));

      return c.json({ income, driver_monthly, driver_today }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return c.json({ error: message }, 500);
    }
  },
);

export default adminDashboard;
