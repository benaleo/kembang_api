import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Bindings, Variables } from '../types';
import { requireAuth } from '../middleware/auth';
import { runAiAgent } from '../lib/ai-agent';
import { pickModel } from '../lib/ai-router';

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
    const apiKey = c.env.GEMINI_API_KEY;

    if (!apiKey) {
      return c.json({ error: 'GEMINI_API_KEY is not configured' }, 500);
    }

    // Only pass user/assistant messages to the agent (drop any tool messages from client)
    const cleanMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const modelSelection = await pickModel(c.get('supabase'));

    if (!modelSelection.model_id) {
      const msg = `Semua model AI sedang limit. Coba lagi ~${modelSelection.est_wait_seconds} detik.`;
      const encoder = new TextEncoder();
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`),
          );
          controller.close();
        },
      });
      return new Response(errorStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    const stream = await runAiAgent(cleanMessages, c.get('supabase'), apiKey, modelSelection.model_id);

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
