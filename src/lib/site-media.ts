export const SITE_MEDIA_KEY_PATTERN = /^landing\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/;

export function getSiteMediaUrl(requestUrl: string, apiPublicUrl: string | undefined, key: string): string {
  const baseUrl = (apiPublicUrl?.trim() || new URL(requestUrl).origin).replace(/\/+$/, '');
  return `${baseUrl}/api/v1/site-content/media/${key}`;
}
