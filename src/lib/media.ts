const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const WEBP_CONTENT_TYPE = 'image/webp';
export const WEBP_QUALITY = 85;
export const SITE_MEDIA_KEY_PATTERN = new RegExp(`^landing/\\d{4}-\\d{2}-\\d{2}/${UUID_PATTERN}\\.(jpg|png|webp|avif)$`);
export const PRODUCT_IMAGE_KEY_PATTERN = new RegExp(`^products/\\d{4}-\\d{2}-\\d{2}/${UUID_PATTERN}\\.(jpg|png|webp|avif)$`);

export function getImageExtension(mimeType: string): string | undefined {
  return IMAGE_EXTENSIONS[mimeType];
}

export async function hasValidImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === 'image/png') return bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (file.type === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  if (file.type === 'image/avif') {
    const box = String.fromCharCode(...bytes.slice(4, 12));
    return box.startsWith('ftyp') && (box.includes('avif') || box.includes('avis'));
  }
  return false;
}

export async function convertImageToWebp(images: ImagesBinding, file: File): Promise<ArrayBuffer> {
  const result = await images.input(file.stream()).output({
    format: WEBP_CONTENT_TYPE,
    quality: WEBP_QUALITY,
    anim: false,
  });
  return result.response().arrayBuffer();
}

export function getSiteMediaUrl(requestUrl: string, apiPublicUrl: string | undefined, key: string): string {
  const baseUrl = (apiPublicUrl?.trim() || new URL(requestUrl).origin).replace(/\/+$/, '');
  return `${baseUrl}/api/v1/site-content/media/${key}`;
}

export function getR2PublicUrl(key: string | null | undefined, publicBaseUrl: string): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return `${publicBaseUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}
