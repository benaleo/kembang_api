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

    const stream = await runAiAgent(cleanMessages, c.get('supabase'), apiKey);

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  },
);

export default aiChat;
