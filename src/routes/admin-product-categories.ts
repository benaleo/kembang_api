import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { generateUniqueSlug } from '../lib/slug';

const adminProductCategories = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const categorySchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
});

const categoryBodySchema = z.object({
  name: z.string().min(1),
});

const idParamSchema = z.object({
  id: z.coerce.number().int(),
});

const errorResponse = z.object({ error: z.string() });

// List categories
adminProductCategories.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admin Product Categories'],
    responses: {
      200: {
        description: 'List product categories',
        content: { 'application/json': { schema: z.object({ data: z.array(categorySchema) }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('product_categories')
      .select('id, name, slug')
      .order('name', { ascending: true });

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ data: data ?? [] }, 200);
  },
);

// Create category
adminProductCategories.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admin Product Categories'],
    request: {
      body: { content: { 'application/json': { schema: categoryBodySchema } } },
    },
    responses: {
      201: {
        description: 'Category created',
        content: { 'application/json': { schema: categorySchema } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  }),
  async (c) => {
    const { name } = c.req.valid('json');
    const supabase = c.get('supabase');

    try {
      const slug = await generateUniqueSlug(supabase, 'product_categories', name);

      const { data, error } = await supabase
        .from('product_categories')
        .insert([{ name, slug }])
        .select('id, name, slug')
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.json(data, 201);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Update category
adminProductCategories.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admin Product Categories'],
    request: {
      params: idParamSchema,
      body: { content: { 'application/json': { schema: categoryBodySchema } } },
    },
    responses: {
      200: {
        description: 'Category updated',
        content: { 'application/json': { schema: categorySchema } },
      },
      404: {
        description: 'Category not found',
        content: { 'application/json': { schema: errorResponse } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const supabase = c.get('supabase');

    try {
      const slug = await generateUniqueSlug(supabase, 'product_categories', name, id);

      const { data, error } = await supabase
        .from('product_categories')
        .update({ name, slug })
        .eq('id', id)
        .select('id, name, slug')
        .maybeSingle();

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      if (!data) {
        return c.json({ error: 'Category not found' }, 404);
      }

      // Keep the denormalized products.category text in sync with the rename
      await supabase.from('products').update({ category: name }).eq('product_category_id', id);

      return c.json(data, 200);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

// Delete category
adminProductCategories.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Admin Product Categories'],
    request: { params: idParamSchema },
    responses: {
      204: { description: 'Category deleted' },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: errorResponse } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const supabase = c.get('supabase');

    try {
      const { error } = await supabase.from('product_categories').delete().eq('id', id);

      if (error) {
        return c.json({ error: error.message }, 500);
      }

      return c.body(null, 204);
    } catch (err) {
      return c.json({ error: 'Internal server error' }, 500);
    }
  },
);

export default adminProductCategories;
