const BASE = 'https://api.telegram.org';

export async function getUpdates(token: string, offset?: number): Promise<any[]> {
  const url = new URL(`bot${token}/getUpdates`, BASE);
  if (offset !== undefined) url.searchParams.set('offset', String(offset));
  const res = await fetch(url.toString());
  const json = (await res.json()) as { ok: boolean; result: any[] };
  return json.ok ? json.result : [];
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<any> {
  const res = await fetch(`${BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.json();
}

export async function setWebhook(token: string, url: string): Promise<any> {
  const res = await fetch(`${BASE}/bot${token}/setWebhook?url=${encodeURIComponent(url)}`);
  return res.json();
}
