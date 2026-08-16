import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { runAiAgent } from '../lib/ai-agent';

const aiChat = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();
aiChat.use('/*', requireAuth);

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});

aiChat.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['AI Chat'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: chatRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'SSE stream with AI response',
        content: { 'text/event-stream': { schema: z.any() } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const { messages } = c.req.valid('json');
    const apiKey = c.env.OMNIROUTER_API_KEY;

    if (!apiKey) {
      return c.json({ error: 'OMNIROUTER_API_KEY is not configured' }, 500);
    }

    const cleanMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const supabase = c.get('supabase') as any;
    const userId = c.get('userId');

    const lastUserMessage = cleanMessages[cleanMessages.length - 1];
    if (lastUserMessage?.role === 'user') {
      c.executionCtx.waitUntil(
        supabase.from('ai_chat_messages').insert({
          user_id: userId,
          role: 'user',
          content: lastUserMessage.content,
        }),
      );
    }

    const stream = await runAiAgent(cleanMessages, supabase, apiKey);

    let assistantText = '';
    const decoder = new TextDecoder();
    const tap = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        const text = decoder.decode(chunk, { stream: true });
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const event = JSON.parse(trimmed.slice(5).trim());
            if (event.type === 'delta' && typeof event.text === 'string') {
              assistantText += event.text;
            }
          } catch {
            // ignore partial/non-JSON SSE lines
          }
        }
      },
      flush() {
        if (assistantText) {
          c.executionCtx.waitUntil(
            supabase.from('ai_chat_messages').insert({
              user_id: userId,
              role: 'assistant',
              content: assistantText,
            }),
          );
        }
      },
    });

    return new Response(stream.pipeThrough(tap), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  },
);

aiChat.openapi(
  createRoute({
    method: 'get',
    path: '/history',
    tags: ['AI Chat'],
    responses: {
      200: {
        description: 'Chat history for the current user',
        content: {
          'application/json': {
            schema: z.array(
              z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string(),
                created_at: z.string(),
              }),
            ),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase') as any;
    const userId = c.get('userId');

    const { data, error } = await supabase
      .from('ai_chat_messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json(data ?? []);
  },
);

aiChat.openapi(
  createRoute({
    method: 'delete',
    path: '/history',
    tags: ['AI Chat'],
    responses: {
      200: {
        description: 'Chat history cleared',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
      500: {
        description: 'Server error',
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase') as any;
    const userId = c.get('userId');

    const { error } = await supabase.from('ai_chat_messages').delete().eq('user_id', userId);

    if (error) {
      return c.json({ error: error.message }, 500);
    }

    return c.json({ success: true }, 200);
  },
);

export default aiChat;
