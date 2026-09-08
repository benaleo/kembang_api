import { z } from '@hono/zod-openapi';

const safeLinkSchema = z.string().min(1).max(2048).refine((value) => {
  if ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('#')) return true;
  try {
    const url = new URL(value);
    return ['https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
}, 'Link harus berupa path internal, anchor, atau URL https/mailto/tel');

const imageUrlSchema = z.string().max(2048).refine((value) => {
  if (value === '' || (value.startsWith('/') && !value.startsWith('//'))) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Gambar harus berupa path internal atau URL HTTPS');

const text = (max = 500) => z.string().trim().min(1).max(max);
const linkSchema = z.object({ label: text(80), href: safeLinkSchema });
const sectionHeadingSchema = z.object({
  eyebrow: text(100),
  title: text(120),
  highlightedTitle: text(120),
});
const activeBaseSchema = z.object({ id: z.string().min(1).max(80), isActive: z.boolean() });

export const landingPageContentSchema = z.object({
  seo: z.object({
    title: text(70),
    description: text(180),
    canonicalUrl: z.string().url().refine((value) => new URL(value).protocol === 'https:', 'Canonical harus HTTPS'),
    ogImageUrl: imageUrlSchema.refine((value) => value !== '', 'OG image wajib diisi'),
    robots: z.enum(['index,follow', 'noindex,nofollow']),
  }),
  brand: z.object({ name: text(100), navLabel: text(100) }),
  hero: z.object({
    eyebrow: text(100),
    title: text(100),
    highlightedTitle: text(100),
    tagline: text(160),
    description: text(500),
    primaryCta: linkSchema,
  }),
  about: sectionHeadingSchema.extend({
    paragraphs: z.array(text(1000)).min(1).max(6),
    imageUrl: imageUrlSchema,
    imageAlt: text(180),
    cta: linkSchema,
  }),
  philosophy: sectionHeadingSchema.extend({
    primaryItems: z.array(activeBaseSchema.extend({
      imageUrl: imageUrlSchema,
      imageAlt: text(180),
      name: text(100),
      tagline: text(120),
      description: text(1000),
    })).max(8),
    secondaryLabel: text(100),
    secondaryItems: z.array(activeBaseSchema.extend({
      imageUrl: imageUrlSchema,
      imageAlt: text(180),
      name: text(100),
      description: text(500),
    })).max(12),
  }),
  collection: sectionHeadingSchema.extend({
    description: text(500),
    items: z.array(activeBaseSchema.extend({
      name: text(120),
      description: text(500),
      priceLabel: text(100),
      imageUrl: imageUrlSchema,
      imageAlt: text(180),
      href: safeLinkSchema,
    })).max(12),
    cta: linkSchema,
  }),
  featuresSection: sectionHeadingSchema,
  features: z.array(activeBaseSchema.extend({
    icon: z.enum(['leaf', 'bud', 'sparkle', 'star']),
    title: text(120),
    description: text(500),
  })).max(8),
  testimonialsSection: sectionHeadingSchema,
  testimonials: z.array(activeBaseSchema.extend({
    name: text(120),
    role: text(160),
    quote: text(1000),
    avatarUrl: imageUrlSchema.optional().default(''),
    avatarAlt: z.string().max(180).optional().default(''),
    avatarText: z.string().max(10).optional().default(''),
  })).max(12),
  location: z.object({
    eyebrow: text(100),
    title: text(120),
    description: text(500),
    addressLines: z.array(text(180)).min(1).max(8),
    mapEmbedUrl: z.string().url().refine((value) => {
      const host = new URL(value).hostname;
      return host === 'www.google.com' || host === 'maps.google.com';
    }, 'Map embed harus menggunakan Google Maps'),
    mapLinkUrl: safeLinkSchema,
    openingHours: z.array(z.object({ label: text(100), value: text(100) })).max(10),
    phone: text(40),
    whatsappUrl: safeLinkSchema,
    cta: linkSchema,
  }),
  finalCta: z.object({
    title: text(160),
    description: text(500),
    primaryCta: linkSchema,
    secondaryCta: linkSchema.optional(),
  }),
});

export type LandingPageContent = z.infer<typeof landingPageContentSchema>;

export const sitePagePublicResponseSchema = z.object({
  schema_version: z.number().int().positive(),
  published_version: z.number().int().positive(),
  published_at: z.string().nullable(),
  content: landingPageContentSchema,
});
