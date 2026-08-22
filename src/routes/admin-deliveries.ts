import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminDeliveries = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminDeliveries.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Deliveries'],
    responses: {
      200: {
        description: 'List deliveries',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: List deliveries by date
  // Query param: ?date=YYYY-MM-DD (defaults to today)
  // Returns deliveries with associated order and customer info
  (c) => c.json({ message: 'TODO: GET /deliveries?date=YYYY-MM-DD' }),
);

adminDeliveries.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Deliveries'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({}).passthrough() } },
      },
    },
    responses: {
      201: {
        description: 'Delivery created',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: Create a new delivery record
  // Parse body: { order_id, scheduled_date, driver_id, route_notes }
  // Insert into deliveries table
  (c) => c.json({ message: 'TODO: POST /deliveries' }, 201),
);

adminDeliveries.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['Admin Deliveries'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({}).passthrough() } },
      },
    },
    responses: {
      200: {
        description: 'Delivery updated',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: Update delivery status or route
  // Parse body: { id, status, driver_id, actual_delivery_time, notes }
  // Supported statuses: pending, in_transit, delivered, failed
  (c) => c.json({ message: 'TODO: PUT /deliveries' }),
);

export default adminDeliveries;
