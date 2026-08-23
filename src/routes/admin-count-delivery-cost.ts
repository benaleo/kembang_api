import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { computeDeliveryCost } from '../lib/delivery-cost';

const adminCountDeliveryCost = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminCountDeliveryCost.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Count Delivery Cost'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              date: z.string(),
              route: z.number(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Delivery cost calculated',
        content: {
          'application/json': {
            schema: z.object({
              distances: z.number(),
              total: z.number(),
              items: z
                .array(
                  z.object({
                    transaction_id: z.number(),
                    customer_id: z.number(),
                    distance_km: z.number(),
                    cost_delivery: z.number(),
                  }),
                )
                .optional(),
            }),
          },
        },
      },
      404: {
        description: 'No transactions / addresses found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase') as any;
    const { date, route } = c.req.valid('json');

    try {
      const result = await computeDeliveryCost(date, route, supabase, c.env.GEOAPIFY_API_KEY);
      return c.json(result, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      const isNotFound =
        message.startsWith('Tidak ada transaksi') || message === 'Customer has no address';
      console.error('count-delivery-cost error:', err);
      if (isNotFound) return c.json({ error: message }, 404);
      return c.json({ error: message }, 500);
    }
  },
);

export default adminCountDeliveryCost;
