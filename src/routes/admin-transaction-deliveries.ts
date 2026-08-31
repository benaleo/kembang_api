import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminTransactionDeliveries = new OpenAPIHono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

const deliverySchema = z.object({
  id: z.number(),
  name: z.string(),
  driver_name: z.string(),
  time: z.string(),
  date: z.string(),
  parent: z.number().nullable(),
  distances: z.number(),
  total: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// GET /?date=YYYY-MM-DD — List deliveries for a date ordered by parent
// ---------------------------------------------------------------------------

adminTransactionDeliveries.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Transaction Deliveries'],
    request: {
      query: z.object({
        date: z.string().min(1),
      }),
    },
    responses: {
      200: {
        description: 'List of transaction deliveries',
        content: { 'application/json': { schema: z.array(deliverySchema) } },
      },
      500: { description: 'Server error', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const date = c.req.query('date') || '';

      const { data, error } = await supabase
        .from('transaction_deliveries')
        .select('*')
        .eq('date', date)
        .order('parent', { ascending: true });

      if (error) return c.json({ error: error.message }, 500);
      return c.json(data || [], 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /upsert-routes — Update or create deliveries for dates × parent routes
// ---------------------------------------------------------------------------

const upsertRoutesBodySchema = z.object({
  dates: z.array(z.string().min(1)).min(1),
  parent_routes: z.array(z.number()).min(1),
  name: z.string().optional().nullable(),
  time: z.string().optional().nullable(),
  driver_name: z.string().optional().nullable(),
  distances: z.number().optional().nullable(),
});

const calcRouteTotal = (distances?: number | null) => {
  if (typeof distances !== 'number' || Number.isNaN(distances)) {
    return null;
  }

  return distances * 3000;
};

const hasValidDistance = (distances?: number | null) => typeof distances === 'number' && !Number.isNaN(distances);

adminTransactionDeliveries.openapi(
  createRoute({
    method: 'post',
    path: '/upsert-routes',
    tags: ['Admin Transaction Deliveries'],
    request: {
      body: { content: { 'application/json': { schema: upsertRoutesBodySchema } } },
    },
    responses: {
      200: {
        description: 'Upsert results per combination',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
              results: z.array(
                z.object({
                  success: z.boolean(),
                  date: z.string(),
                  parent: z.number(),
                  message: z.string(),
                }),
              ),
            }),
          },
        },
      },
      400: { description: 'Invalid request', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
      500: { description: 'Server error', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
    },
  }),
  async (c) => {
    try {
      const supabase = c.get('supabase') as any;
      const body = c.req.valid('json');

      const routeFields = hasValidDistance(body.distances)
        ? {
            distances: body.distances,
            total: calcRouteTotal(body.distances),
          }
        : {};

      const extraFields = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.time !== undefined && body.time !== null ? { time: body.time } : {}),
        ...(body.driver_name !== undefined && body.driver_name !== null
          ? { driver_name: body.driver_name }
          : {}),
        ...routeFields,
      };

      const results: Array<{ success: boolean; date: string; parent: number; message: string }> = [];

      for (const date of body.dates) {
        for (const parentRoute of body.parent_routes) {
          const { data: existingRecords, error: fetchError } = await supabase
            .from('transaction_deliveries')
            .select('id')
            .eq('date', date)
            .eq('parent', parentRoute);

          if (fetchError) return c.json({ error: fetchError.message }, 500);

          if (existingRecords && existingRecords.length > 0) {
            const { error: updateError, count } = await supabase
              .from('transaction_deliveries')
              .update({ ...extraFields })
              .eq('date', date)
              .eq('parent', parentRoute);

            if (updateError) return c.json({ error: updateError.message }, 500);
            results.push({
              success: true,
              date,
              parent: parentRoute,
              message: `${count || existingRecords.length} routes updated`,
            });
          } else {
            const newRecord = {
              name: `Route ${parentRoute}`,
              time: '00:00',
              date,
              parent: parentRoute,
              ...extraFields,
            };

            const { error: insertError } = await supabase
              .from('transaction_deliveries')
              .insert([newRecord]);

            if (insertError) return c.json({ error: insertError.message }, 500);
            results.push({
              success: true,
              date,
              parent: parentRoute,
              message: 'New route created successfully',
            });
          }
        }
      }

      return c.json(
        {
          success: true,
          results,
          message: `Processed ${body.dates.length * body.parent_routes.length} combinations`,
        },
        200,
      );
    } catch (err) {
      return c.json({ error: 'Failed to update transaction delivery routes' }, 500);
    }
  },
);

export default adminTransactionDeliveries;
