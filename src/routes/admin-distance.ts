import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { getDistanceKm } from '../lib/gomaps';

const adminDistance = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminDistance.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Distance'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({ destination: z.string() }) } },
      },
    },
    responses: {
      200: {
        description: 'Distance computed',
        content: { 'application/json': { schema: z.object({ distance: z.number() }) } },
      },
      400: {
        description: 'Invalid request',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { destination } = c.req.valid('json');

    if (!destination) {
      return c.json({ error: 'destination is required' }, 400);
    }

    try {
      const distance = await getDistanceKm(c.env.GOMAPS_APIKEY, destination);
      return c.json({ distance });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to compute distance';
      return c.json({ error: message }, 500);
    }
  }
);

export default adminDistance;
