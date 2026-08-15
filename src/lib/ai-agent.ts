import { aiTools } from './ai-tools';

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOOL_ROUNDS = 10;

const SYSTEM_PROMPT = `Kamu adalah asisten AI untuk toko bunga Kembang. Kamu bisa membantu operator untuk:
- Mencari data pelanggan dan produk
- Menghitung biaya pengiriman dan upah driver
- Membuat pesanan baru (ORDER) — TETAPI kamu HARUS menampilkan detail order untuk dikonfirmasi operator terlebih dahulu SEBELUM benar-benar membuatnya di database
- Melihat daftar pesanan

Aturan:
- Format harga dalam Rupiah: Rp XX.XXX
- Tanya konfirmasi sebelum membuat pesanan (createOrder)
- Gunakan bahasa Indonesia yang sopan dan ringkas
- Kalau data tidak ditemukan, bilang jangan mengarang data`;

type Message = { role: 'user' | 'assistant' | 'tool'; content: string };

interface StreamingBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  _jsonBuffer?: string;
}

/**
 * Run the AI agent with streaming.
 *
 * Returns a ReadableStream<Uint8Array> that yields SSE events:
 * - data: {"type":"delta","text":"..."} — text delta
 * - data: {"type":"done"} — stream finished
 * - data: {"type":"error","message":"..."} — error occurred
 */
export async function runAiAgent(
  messages: Array<Message>,
  supabase: any,
  apiKey: string,
): Promise<ReadableStream<Uint8Array>> {
  return new ResponseStream(messages, supabase, apiKey).body as ReadableStream<Uint8Array>;
}

class ResponseStream {
  body: ReadableStream<Uint8Array>;
  private encoder = new TextEncoder();

  constructor(
    private messages: Array<Message>,
    private supabase: any,
    private apiKey: string,
  ) {
    this.body = new ReadableStream({
      start: (controller) => {
        this.processLoop(controller)
          .then(() => {
            controller.enqueue(this.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
            controller.close();
          })
          .catch((e) => {
            const err = e instanceof Error ? e.message : 'Unknown error';
            controller.enqueue(this.encode(`data: ${JSON.stringify({ type: 'error', message: err })}\n\n`));
            controller.close();
          });
      },
    });
  }

  private encode(s: string): Uint8Array {
    return this.encoder.encode(s);
  }

  private async processLoop(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // 1. Call Messages API
      const response = await this.callApi();
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 200)}`);
      }

      // 2. Read streaming SSE events
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalMessage: any = null;
      let currentText = '';
      const toolUseBlocks: StreamingBlock[] = [];

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          while (buffer.includes('\n\n')) {
            const idx = buffer.indexOf('\n\n');
            const rawLine = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            for (const line of rawLine.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              let event: any;
              try {
                event = JSON.parse(data);
              } catch {
                continue;
              }

              if (event.type === 'message_start') {
                finalMessage = event.message;
              } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
                if (finalMessage) finalMessage.stop_reason = event.delta.stop_reason;
              } else if (event.type === 'content_block_start') {
                const block = event.content_block;
                if (block.type === 'text') {
                  // text block started — no-op, we'll get deltas
                } else if (block.type === 'tool_use') {
                  toolUseBlocks.push({
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: {},
                  });
                }
              } else if (event.type === 'content_block_delta') {
                const delta = event.delta;
                if (delta.type === 'text_delta' && delta.text) {
                  currentText += delta.text;
                  // Yield delta to caller
                  controller.enqueue(
                    this.encode(`data: ${JSON.stringify({ type: 'delta', text: delta.text })}\n\n`),
                  );
                } else if (delta.type === 'input_json_delta' && delta.partial_json) {
                  // Accumulate JSON for tool input
                  const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
                  if (lastTool) {
                    lastTool._jsonBuffer = (lastTool._jsonBuffer || '') + delta.partial_json;
                  }
                }
              } else if (event.type === 'content_block_stop') {
                // Parse accumulated tool input JSON if present
                const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
                if (lastTool && lastTool._jsonBuffer) {
                  try {
                    lastTool.input = JSON.parse(lastTool._jsonBuffer);
                  } catch {
                    lastTool.input = {};
                  }
                  delete (lastTool as any)._jsonBuffer;
                }
              } else if (event.type === 'message_stop') {
                // Done reading stream
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // 3. Check stop_reason
      const stopReason = finalMessage?.stop_reason || 'end_turn';

      if (stopReason === 'end_turn' || stopReason !== 'tool_use') {
        // Text-only response — done
        return;
      }

      // 4. Tool-use round: build assistant message + tool results
      this.messages.push({
        role: 'assistant',
        content: JSON.stringify([
          ...(currentText ? [{ type: 'text', text: currentText }] : []),
          ...toolUseBlocks.map((b) => ({
            type: 'tool_use',
            id: b.id,
            name: b.name,
            input: b.input,
          })),
        ]),
      });

      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

      for (const block of toolUseBlocks) {
        const tool = aiTools.find((t) => t.name === block.name);
        let result: any;
        if (!tool) {
          result = { error: `Tool tidak dikenal: ${block.name}` };
        } else {
          try {
            result = await tool.execute(block.input || {}, this.supabase);
          } catch (e) {
            result = { error: e instanceof Error ? e.message : 'Tool execution error' };
          }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id!,
          content: JSON.stringify(result),
        });
      }

      this.messages.push({
        role: 'tool',
        content: JSON.stringify(toolResults),
      });

      // Reset for next round
      currentText = '';
      toolUseBlocks.length = 0;
    }

    // If we exhausted rounds, just stop (text was already streamed)
  }

  private async callApi(): Promise<Response> {
    // Transform internal messages into Anthropic API format.
    // Tool results are sent as a user message containing tool_result blocks
    // (the Anthropic API has no 'tool' role).
    const apiMessages = this.messages.map((m) => {
      if (m.role === 'tool') {
        let toolResults: Array<{ tool_use_id: string; content: string }>;
        try {
          toolResults = JSON.parse(m.content);
        } catch {
          toolResults = [];
        }
        return {
          role: 'user' as const,
          content: toolResults.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
          })),
        };
      }
      if (m.role === 'assistant') {
        try {
          const parsed = JSON.parse(m.content);
          if (Array.isArray(parsed)) {
            return { role: 'assistant', content: parsed };
          }
        } catch {}
        return { role: 'assistant', content: m.content };
      }
      // user
      try {
        const parsed = JSON.parse(m.content);
        if (Array.isArray(parsed) && parsed[0]?.type === 'tool_result') {
          return { role: 'user', content: parsed };
        }
      } catch {}
      return { role: 'user', content: m.content };
    });

    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: apiMessages,
        tools: aiTools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        stream: true,
      }),
    });
  }
}
