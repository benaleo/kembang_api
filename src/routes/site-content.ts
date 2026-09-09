import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { landingPageContentSchema, sitePagePublicResponseSchema } from '../lib/site-content-schema';
import { SITE_MEDIA_KEY_PATTERN } from '../lib/site-media';

const siteContent = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();
const SITE_MEDIA_PATH_PREFIX = '/api/v1/site-content/media/';

siteContent.get('/media/*', async (c) => {
  const key = c.req.path.startsWith(SITE_MEDIA_PATH_PREFIX)
    ? c.req.path.slice(SITE_MEDIA_PATH_PREFIX.length)
    : '';
  if (!SITE_MEDIA_KEY_PATTERN.test(key)) return c.json({ error: 'Media tidak ditemukan' }, 404);

  let object: R2ObjectBody | null;
  try {
    object = await c.env.SITE_CONTENT_BUCKET.get(key);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'site media read failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Gagal memuat media website' }, 500);
  }
  if (!object) return c.json({ error: 'Media tidak ditemukan' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', object.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
});

siteContent.openapi(
  createRoute({
    method: 'get',
    path: '/home',
    tags: ['Site Content'],
    responses: {
      200: {
        description: 'Published landing page content',
        content: { 'application/json': { schema: sitePagePublicResponseSchema } },
      },
      404: {
        description: 'Published content not found',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { data, error } = await supabase
      .from('site_pages')
      .select('schema_version, published_content, published_version, published_at')
      .eq('slug', 'home')
      .maybeSingle();

    if (error) {
      console.error(JSON.stringify({ message: 'site content read failed', error: error.message }));
      return c.json({ error: 'Gagal memuat konten website' }, 500);
    }
    if (!data?.published_content) return c.json({ error: 'Konten belum dipublish' }, 404);

    const parsed = landingPageContentSchema.safeParse(data.published_content);
    if (!parsed.success) {
      console.error(JSON.stringify({ message: 'published site content is invalid', issues: parsed.error.issues }));
      return c.json({ error: 'Konten website tidak valid' }, 500);
    }

    const version = Number(data.published_version);
    c.header('ETag', `"site-home-${version}"`);
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return c.json({
      schema_version: Number(data.schema_version),
      published_version: version,
      published_at: data.published_at,
      content: parsed.data,
    }, 200);
  },
);

export default siteContent;
