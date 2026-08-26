import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { geoapifySearch, geoapifyReverse, GeoapifyPlace } from '../lib/geoapify';

const placeSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  formatted: z.string(),
});

const SHORT_LINK_HOSTS = new Set(['goo.gl', 'maps.app.goo.gl']);

function isGoogleShortLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return SHORT_LINK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Extract coordinates / place name from a Google Maps URL.
 * Handles: /@lat,lng,zoom, !3dlat!4dlng (pin), and /place/<name>/ patterns.
 */
export function parseGoogleMapsUrl(rawUrl: string): {
  lat?: number;
  lng?: number;
  placeName?: string;
} {
  const result: { lat?: number; lng?: number; placeName?: string } = {};

  // Precise pin: !3d<lat>!4d<lng>
  const pinMatch = rawUrl.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pinMatch) {
    result.lat = parseFloat(pinMatch[1]);
    result.lng = parseFloat(pinMatch[2]);
    return result;
  }

  // Viewport center: /@<lat>,<lng>,zoom
  const atMatch = rawUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,.][^/@!?]*)?(?:[/?]|$)/);
  if (atMatch) {
    result.lat = parseFloat(atMatch[1]);
    result.lng = parseFloat(atMatch[2]);
    return result;
  }

  // Place name fallback: /place/<name>/
  const placeMatch = rawUrl.match(/\/place\/([^/@!?]+)/);
  if (placeMatch) {
    try {
      result.placeName = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
    } catch {
      result.placeName = placeMatch[1];
    }
  }

  return result;
}

const adminGeocode = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// -------------------------------------------------------------------------
// GET /google-place?url=<google maps url> — Resolve location from a
// Google Maps link (incl. short links) into { lat, lng, formatted }.
// -------------------------------------------------------------------------

adminGeocode.openapi(
  createRoute({
    method: 'get',
    path: '/google-place',
    tags: ['Admin Geocode'],
    request: {
      query: z.object({
        url: z.string().url(),
      }),
    },
    responses: {
      200: {
        description: 'Resolved place from Google Maps URL (null when not resolvable)',
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
    try {
      let target = c.req.valid('query').url;

      // Follow short links (maps.app.goo.gl, goo.gl/maps) server-side —
      // browsers can't do this due to CORS.
      //
      // Dicek per-hostname, bukan substring: regex /goo\.gl|maps\.app/ juga
      // match `https://evil.com/goo.gl/x`, jadi endpoint ini bisa dipakai
      // sebagai URL-fetching proxy ke host mana pun.
      if (isGoogleShortLink(target)) {
        const res = await fetch(target, { redirect: 'follow' });
        if (!res.ok) {
          return c.json({ error: `Failed to resolve short link: HTTP ${res.status}` }, 400);
        }
        target = res.url;
      }

      const parsed = parseGoogleMapsUrl(target);

      if (parsed.lat !== undefined && parsed.lng !== undefined) {
        // Coordinates found — reverse geocode so the address field gets filled too
        const place = await geoapifyReverse(c.env.GEOAPIFY_API_KEY, parsed.lat, parsed.lng);
        return c.json(
          {
            lat: parsed.lat,
            lng: parsed.lng,
            formatted:
              place?.formatted ||
              `${parsed.lat.toFixed(6)}, ${parsed.lng.toFixed(6)}`,
          },
          200,
        );
      }

      if (parsed.placeName) {
        // No coordinates in the link — fall back to forward geocoding the place name
        const place = await geoapifySearch(c.env.GEOAPIFY_API_KEY, `${parsed.placeName} Indonesia`);
        if (!place) return c.json(null, 200);
        return c.json(place, 200);
      }

      return c.json(null, 200);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to resolve Google Maps URL';
      return c.json({ error: message }, 500);
    }
  }
);

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
