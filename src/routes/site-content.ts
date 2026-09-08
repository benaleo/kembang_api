import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { landingPageContentSchema, sitePagePublicResponseSchema } from '../lib/site-content-schema';

const siteContent = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

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
