import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';

const adminOrders = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminOrders.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Orders'],
    responses: {
      200: {
        description: 'List orders',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: List orders - support query params: status, date_range, customer_id
  // Query orders table with optional filters
  (c) => c.json({ message: 'TODO: GET /orders' }),
);

adminOrders.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Orders'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({}).passthrough() } },
      },
    },
    responses: {
      201: {
        description: 'Order created',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: Create a new order
  // Parse body: { customer_id, items, delivery_date, delivery_address, notes }
  // Insert into orders table, create associated order_items
  (c) => c.json({ message: 'TODO: POST /orders' }, 201),
);

adminOrders.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['Admin Orders'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({}).passthrough() } },
      },
    },
    responses: {
      200: {
        description: 'Order updated',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: Update an existing order
  // Parse body: { id, status, items, delivery_date, notes }
  // Update order and order_items in a transaction
  (c) => c.json({ message: 'TODO: PUT /orders' }),
);

adminOrders.openapi(
  createRoute({
    method: 'delete',
    path: '/',
    tags: ['Admin Orders'],
    responses: {
      200: {
        description: 'Order cancelled',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  // TODO: Cancel / delete an order
  // Parse query param: ?id=<order_id>
  // Soft-delete or hard-delete depending on policy
  (c) => c.json({ message: 'TODO: DELETE /orders' }),
);

export default adminOrders;
