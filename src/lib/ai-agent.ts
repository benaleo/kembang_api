import { aiTools } from './ai-tools';

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

type Message = { role: 'user' | 'assistant'; content: string };

function toGeminiContents(messages: Message[]): any[] {
  return messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
}

function toGeminiTools(): any[] {
  return [
    {
      function_declarations: aiTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    },
  ];
}

/**
 * Run the AI agent and return a ReadableStream that yields SSE events:
 * - data: {"type":"delta","text":"..."} — text delta
 * - data: {"type":"done"} — stream finished
 * - data: {"type":"error","message":"..."} — error occurred
 */
export async function runAiAgent(
  messages: Array<Message>,
  supabase: any,
  apiKey: string,
  model: string = 'gemini-2.5-flash',
): Promise<ReadableStream<Uint8Array>> {
  return new ResponseStream(messages, supabase, apiKey, model).body as ReadableStream<Uint8Array>;
}

class ResponseStream {
  body: ReadableStream<Uint8Array>;
  private encoder = new TextEncoder();
  private contents: any[];

  constructor(
    private messages: Array<Message>,
    private supabase: any,
    private apiKey: string,
    private model: string,
  ) {
    this.contents = toGeminiContents(messages);
    this.body = new ReadableStream({
      start: (controller) => {
        this.processLoop(controller)
          .then(() => {
            controller.enqueue(
              this.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`),
            );
            controller.close();
          })
          .catch((e) => {
            const err = e instanceof Error ? e.message : 'Unknown error';
            controller.enqueue(
              this.encode(`data: ${JSON.stringify({ type: 'error', message: err })}\n\n`),
            );
            controller.close();
          });
      },
    });
  }

  private encode(s: string): Uint8Array {
    return this.encoder.encode(s);
  }

  private async processLoop(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<void> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 90_000); // 90s per Gemini call

      try {
        const response = await this.callApi(ac.signal);
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Gemini API error ${response.status}: ${body.slice(0, 200)}`);
        }

        // Read SSE stream from Gemini
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentText = '';
        const toolCalls: Array<{ name: string; args: any }> = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr) continue;

              try {
                const event = JSON.parse(jsonStr);
                const parts = event.candidates?.[0]?.content?.parts || [];

                for (const part of parts) {
                  if (part.thought) continue;

                  if (part.text) {
                    currentText += part.text;
                    controller.enqueue(
                      this.encode(`data: ${JSON.stringify({ type: 'delta', text: part.text })}\n\n`),
                    );
                  } else if (part.functionCall) {
                    toolCalls.push({
                      name: part.functionCall.name,
                      args: part.functionCall.args || {},
                    });
                  }
                }
              } catch {
                // Skip malformed SSE chunks
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        if (toolCalls.length === 0) {
          return;
        }

        // Append model's function calls to contents
        this.contents.push({
          role: 'model',
          parts: toolCalls.map((tc) => ({
            functionCall: { name: tc.name, args: tc.args },
          })),
        });

        // Execute each tool and collect function responses
        const functionResponses: any[] = [];
        for (const tc of toolCalls) {
          let result: any;
          try {
            const tool = aiTools.find((t) => t.name === tc.name);
            if (!tool) {
              result = { error: `Tool tidak dikenal: ${tc.name}` };
            } else {
              result = await tool.execute(tc.args, this.supabase);
            }
          } catch (e) {
            result = { error: e instanceof Error ? e.message : 'Tool execution error' };
          }
          functionResponses.push({
            functionResponse: { name: tc.name, response: result },
          });
        }

        this.contents.push({ role: 'user', parts: functionResponses });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async callApi(signal?: AbortSignal): Promise<Response> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse`;
    return fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: this.contents,
        tools: toGeminiTools(),
      }),
      signal,
    });
  }
}
