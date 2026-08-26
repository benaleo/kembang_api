import { Context } from 'hono';
import { Bindings, Variables } from '../types';
import { AiToolContext } from './ai-tools';

/**
 * Bangun konteks self-call internal dari env request.
 *
 * Base URL diambil dari API_PUBLIC_URL kalau ada, kalau tidak dari origin
 * request yang sedang berjalan (di Workers ini origin service sebenarnya —
 * bukan localhost). Return null kalau INTERNAL_API_TOKEN belum di-set, supaya
 * tool yang butuh self-call gagal dengan pesan jelas, bukan diam-diam nembak
 * host yang salah.
 */
export function buildInternalToolContext(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
): AiToolContext | undefined {
  const internalToken = c.env.INTERNAL_API_TOKEN;
  if (!internalToken) return undefined;

  const baseUrl = (c.env.API_PUBLIC_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
  return { baseUrl, internalToken };
}
