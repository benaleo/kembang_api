import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { sendMessage } from '../lib/telegram';
import { runAiAgent } from '../lib/ai-agent';

const telegramWebhook = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

const webhookUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
    })
    .optional(),
});

telegramWebhook.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Telegram Webhook'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: webhookUpdateSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
      },
    },
  }),
  async (c) => {
    try {
      const botToken = c.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        console.error('TELEGRAM_BOT_TOKEN is not configured');
        return c.json({ ok: true as const }, 200);
      }

      const allowedChatIds = c.env.TELEGRAM_ALLOWED_CHAT_IDS
        ? c.env.TELEGRAM_ALLOWED_CHAT_IDS.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map(Number)
        : [];

      const update = c.req.valid('json');

      if (!update.message?.text) {
        return c.json({ ok: true as const }, 200);
      }

      const chatId = update.message.chat.id;

      if (allowedChatIds.length > 0 && !allowedChatIds.includes(chatId)) {
        await sendMessage(botToken, chatId, 'Maaf, Anda tidak diizinkan mengakses bot ini.');
        return c.json({ ok: true as const }, 200);
      }

      const userText = update.message.text;
      const supabase = c.get('supabase');
      const apiKey = c.env.OMNIROUTER_API_KEY;

      if (!apiKey) {
        await sendMessage(botToken, chatId, 'Error: OMNIROUTER_API_KEY belum dikonfigurasi.');
        return c.json({ ok: true as const }, 200);
      }

      // Fetch session from KV
      const kv = c.env.AI_SESSIONS as any;
      const sessionKey = `tg_${chatId}`;
      let sessionMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      if (kv) {
        const raw = await kv.get(sessionKey);
        if (raw) {
          try {
            sessionMessages = JSON.parse(raw);
          } catch {
            sessionMessages = [];
          }
        }
      }

      sessionMessages.push({ role: 'user', content: userText });

      // Run AI agent (non-streaming: collect all deltas)
      const stream = await runAiAgent(sessionMessages, supabase, apiKey);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n\n')) {
            const idx = buffer.indexOf('\n\n');
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            for (const line of raw.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'delta') fullText += data.text;
                if (data.type === 'error') fullText += `\n\nError: ${data.message}`;
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      const replyText = fullText.trim() || 'Maaf, tidak ada respons.';
      await sendMessage(botToken, chatId, replyText);

      sessionMessages.push({ role: 'assistant', content: replyText });
      if (sessionMessages.length > 20) {
        sessionMessages = sessionMessages.slice(-20);
      }

      if (kv) {
        await kv.put(sessionKey, JSON.stringify(sessionMessages), {
          expirationTtl: 86400,
        });
      }

      return c.json({ ok: true as const }, 200);
    } catch (err) {
      console.error('Telegram webhook error:', err);
      return c.json({ ok: true as const }, 200);
    }
  },
);

export default telegramWebhook;
