import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { geoapifySearch, geoapifyReverse, GeoapifyPlace } from '../lib/geoapify';

const placeSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  formatted: z.string(),
});

const adminGeocode = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

adminGeocode.openapi(
  createRoute({
    method: 'get',
    path: '/search',
    tags: ['Admin Geocode'],
    request: {
      query: z.object({
        text: z.string().min(1),
      }),
    },
    responses: {
      200: {
        description: 'Forward geocode result (null when not found)',
        content: { 'application/json': { schema: placeSchema.nullable() } },
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
    const { text } = c.req.valid('query');

    try {
      const place: GeoapifyPlace | null = await geoapifySearch(c.env.GEOAPIFY_API_KEY, text);
      return c.json(place, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to geocode address';
      return c.json({ error: message }, 500);
    }
  }
);

adminGeocode.openapi(
  createRoute({
    method: 'get',
    path: '/reverse',
    tags: ['Admin Geocode'],
    request: {
      query: z.object({
        lat: z.string(),
        lon: z.string(),
      }),
    },
    responses: {
      200: {
        description: 'Reverse geocode result (null when not found)',
        content: { 'application/json': { schema: placeSchema.nullable() } },
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
    const { lat, lon } = c.req.valid('query');
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return c.json({ error: 'lat/lon must be valid numbers' }, 400);
    }

    try {
      const place: GeoapifyPlace | null = await geoapifyReverse(
        c.env.GEOAPIFY_API_KEY,
        latNum,
        lonNum
      );
      return c.json(place, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to reverse geocode coordinates';
      return c.json({ error: message }, 500);
    }
  }
);

export default adminGeocode;
