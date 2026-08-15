import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { sendMessage } from '../lib/telegram';
import { runAiAgent } from '../lib/ai-agent';
import { pickModel } from '../lib/ai-router';

const telegramWebhook = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// Telegram webhook update schema (minimal — only what we need)
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
    // No auth — called by Telegram servers
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
        return c.json({ ok: true as const });
      }

      const allowedChatIds = c.env.TELEGRAM_ALLOWED_CHAT_IDS
        ? c.env.TELEGRAM_ALLOWED_CHAT_IDS.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map(Number)
        : [];

      const update = c.req.valid('json');

      // Ignore messages that aren't text
      if (!update.message?.text) {
        return c.json({ ok: true as const });
      }

      const chatId = update.message.chat.id;

      // Check allowlist
      if (allowedChatIds.length > 0 && !allowedChatIds.includes(chatId)) {
        await sendMessage(botToken, chatId, 'Maaf, Anda tidak diizinkan mengakses bot ini.');
        return c.json({ ok: true as const });
      }

      const userText = update.message.text;
      const supabase = c.get('supabase');
      const apiKey = c.env.GEMINI_API_KEY;

      if (!apiKey) {
        await sendMessage(botToken, chatId, 'Error: GEMINI_API_KEY belum dikonfigurasi.');
        return c.json({ ok: true as const });
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

      // Add user message
      sessionMessages.push({ role: 'user', content: userText });

      const modelSelection = await pickModel(supabase);

      if (!modelSelection.model_id) {
        await sendMessage(botToken, chatId, `Semua model AI sedang limit. Coba lagi ~${modelSelection.est_wait_seconds} detik.`);
        return c.json({ ok: true as const });
      }

      // Run AI agent (non-streaming: collect all deltas)
      const stream = await runAiAgent(sessionMessages, supabase, apiKey, modelSelection.model_id);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE deltas to collect text
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
              } catch {
                // skip
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Send reply
      const replyText = fullText.trim() || 'Maaf, tidak ada respons.';
      await sendMessage(botToken, chatId, replyText);

      // Update session (keep last 20 messages)
      sessionMessages.push({ role: 'assistant', content: replyText });
      if (sessionMessages.length > 20) {
        sessionMessages = sessionMessages.slice(-20);
      }

      if (kv) {
        await kv.put(sessionKey, JSON.stringify(sessionMessages), {
          expirationTtl: 86400, // 24 hours
        });
      }

      return c.json({ ok: true as const });
    } catch (err) {
      console.error('Telegram webhook error:', err);
      return c.json({ ok: true as const }); // Always return 200 to Telegram
    }
  },
);

export default telegramWebhook;
