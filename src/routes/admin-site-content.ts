import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { landingPageContentSchema } from '../lib/site-content-schema';
import {
  convertImageToWebp,
  getImageExtension,
  getSiteMediaUrl,
  hasValidImageSignature,
  MAX_IMAGE_SIZE,
  SITE_MEDIA_KEY_PATTERN,
  WEBP_CONTENT_TYPE,
} from '../lib/media';

const adminSiteContent = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const errorSchema = z.object({ error: z.string() });
const adminPageSchema = z.object({
  schema_version: z.number(),
  draft_content: landingPageContentSchema,
  published_content: landingPageContentSchema,
  published_version: z.number(),
  updated_at: z.string(),
  published_at: z.string().nullable(),
  has_unpublished_changes: z.boolean(),
});

function contentChanged(draft: unknown, published: unknown): boolean {
  return JSON.stringify(draft) !== JSON.stringify(published);
}

async function queueDeployment(hookUrl?: string): Promise<{ queued: boolean; error?: string }> {
  if (!hookUrl) return { queued: false, error: 'VERCEL_DEPLOY_HOOK_URL belum dikonfigurasi' };

  try {
    const response = await fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'kembang-cms', page: 'home' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { queued: false, error: `Deploy Hook merespons ${response.status}` };
    return { queued: true };
  } catch (error) {
    console.error(JSON.stringify({
      message: 'vercel deploy hook failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return { queued: false, error: 'Deploy Hook tidak dapat dihubungi' };
  }
}

adminSiteContent.openapi(
  createRoute({
    method: 'get',
    path: '/home',
    tags: ['Admin Site Content'],
    responses: {
      200: { description: 'Landing page draft', content: { 'application/json': { schema: adminPageSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: errorSchema } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { data, error } = await c.get('supabase')
      .from('site_pages')
      .select('schema_version, draft_content, published_content, published_version, updated_at, published_at')
      .eq('slug', 'home')
      .maybeSingle();

    if (error) return c.json({ error: error.message }, 500);
    if (!data) return c.json({ error: 'Landing page belum tersedia' }, 404);

    const draft = landingPageContentSchema.safeParse(data.draft_content);
    const published = landingPageContentSchema.safeParse(data.published_content);
    if (!draft.success || !published.success) return c.json({ error: 'Konten tersimpan tidak valid' }, 500);

    return c.json({
      schema_version: Number(data.schema_version),
      draft_content: draft.data,
      published_content: published.data,
      published_version: Number(data.published_version),
      updated_at: data.updated_at,
      published_at: data.published_at,
      has_unpublished_changes: contentChanged(draft.data, published.data),
    }, 200);
  },
);

adminSiteContent.openapi(
  createRoute({
    method: 'put',
    path: '/home/draft',
    tags: ['Admin Site Content'],
    request: { body: { content: { 'application/json': { schema: landingPageContentSchema } } } },
    responses: {
      200: { description: 'Draft saved', content: { 'application/json': { schema: z.object({ success: z.boolean(), updated_at: z.string() }) } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const content = c.req.valid('json');
    const updatedAt = new Date().toISOString();
    const { error } = await c.get('supabase')
      .from('site_pages')
      .update({ draft_content: content, updated_by: c.get('userId'), updated_at: updatedAt })
      .eq('slug', 'home');

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true, updated_at: updatedAt }, 200);
  },
);

adminSiteContent.openapi(
  createRoute({
    method: 'post',
    path: '/home/publish',
    tags: ['Admin Site Content'],
    responses: {
      200: {
        description: 'Content published',
        content: { 'application/json': { schema: z.object({
          success: z.boolean(),
          published_version: z.number(),
          published_at: z.string(),
        }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: errorSchema } } },
      500: { description: 'Server error', content: { 'application/json': { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { data, error: readError } = await supabase
      .from('site_pages')
      .select('draft_content, published_version')
      .eq('slug', 'home')
      .maybeSingle();
    if (readError) return c.json({ error: readError.message }, 500);
    if (!data) return c.json({ error: 'Landing page belum tersedia' }, 404);

    const parsed = landingPageContentSchema.safeParse(data.draft_content);
    if (!parsed.success) return c.json({ error: 'Draft tidak valid dan tidak dapat dipublish' }, 500);

    const { data: publishRows, error: updateError } = await supabase.rpc('site_publish_page', {
      p_slug: 'home',
      p_user_id: c.get('userId'),
    });
    if (updateError) return c.json({ error: updateError.message }, 500);
    const publishResult = publishRows?.[0];
    if (!publishResult) return c.json({ error: 'Landing page belum tersedia' }, 404);
    const publishedAt = publishResult.published_at as string;
    const publishedVersion = Number(publishResult.published_version);

    return c.json({
      success: true,
      published_version: publishedVersion,
      published_at: publishedAt,
    }, 200);
  },
);

adminSiteContent.openapi(
  createRoute({
    method: 'post',
    path: '/home/rebuild',
    tags: ['Admin Site Content'],
    responses: {
      200: { description: 'Manual website deployment result', content: { 'application/json': { schema: z.object({ deployment_queued: z.boolean(), deployment_error: z.string().optional() }) } } },
    },
  }),
  async (c) => {
    const deployment = await queueDeployment(c.env.VERCEL_DEPLOY_HOOK_URL);
    return c.json({
      deployment_queued: deployment.queued,
      ...(deployment.error ? { deployment_error: deployment.error } : {}),
    }, 200);
  },
);

adminSiteContent.post('/media', async (c) => {
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > 6 * 1024 * 1024) return c.json({ error: 'Ukuran request terlalu besar' }, 413);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'File gambar wajib diisi' }, 400);
  const extension = getImageExtension(file.type);
  if (!extension) return c.json({ error: 'Format gambar harus JPEG, PNG, WebP, atau AVIF' }, 400);
  if (file.size > MAX_IMAGE_SIZE) return c.json({ error: 'Ukuran gambar maksimal 5 MB' }, 400);
  if (!(await hasValidImageSignature(file))) return c.json({ error: 'Isi file tidak sesuai format gambar' }, 400);

  const path = `landing/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.webp`;
  try {
    const webp = await convertImageToWebp(c.env.IMAGES, file);
    await c.env.SITE_CONTENT_BUCKET.put(path, webp, {
      httpMetadata: {
        contentType: WEBP_CONTENT_TYPE,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'site media upload failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Gagal menyimpan gambar website' }, 500);
  }

  return c.json({
    path,
    url: getSiteMediaUrl(c.req.url, c.env.API_PUBLIC_URL, path),
  }, 201);
});

adminSiteContent.delete('/media', async (c) => {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    return c.json({ error: 'Body JSON tidak valid' }, 400);
  }
  const parsed = z.object({ path: z.string().regex(SITE_MEDIA_KEY_PATTERN) }).safeParse(input);
  if (!parsed.success) return c.json({ error: 'Path media tidak valid' }, 400);

  const supabase = c.get('supabase');
  const { data: page, error: readError } = await supabase
    .from('site_pages')
    .select('draft_content, published_content')
    .eq('slug', 'home')
    .maybeSingle();
  if (readError) return c.json({ error: readError.message }, 500);

  const serialized = JSON.stringify(page ?? {});
  if (serialized.includes(parsed.data.path)) return c.json({ error: 'Media masih digunakan oleh landing page' }, 409);

  try {
    await c.env.SITE_CONTENT_BUCKET.delete(parsed.data.path);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'site media delete failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return c.json({ error: 'Gagal menghapus gambar website' }, 500);
  }
  return c.json({ success: true }, 200);
});

export default adminSiteContent;
