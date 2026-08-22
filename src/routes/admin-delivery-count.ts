import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminDeliveryCount = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminDeliveryCount.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Delivery Count'],
    request: {
      query: z.object({
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Delivery count',
        content: {
          'application/json': {
            schema: z.object({
              message: z.string(),
              params: z.object({ start_date: z.string().nullable(), end_date: z.string().nullable() }),
            }),
          },
        },
      },
    },
  }),
  (c) => {
    const startDate = c.req.query('start_date') ?? null;
    const endDate = c.req.query('end_date') ?? null;

    // TODO: Count deliveries within date range
    // - start_date and end_date are required query params (format: YYYY-MM-DD)
    // - Return total count plus breakdown by status (pending, in_transit, delivered, failed)
    // - Optionally group by date for charting purposes

    return c.json({
      message: 'TODO: GET /delivery-count',
      params: { start_date: startDate, end_date: endDate },
    });
  },
);

export default adminDeliveryCount;
