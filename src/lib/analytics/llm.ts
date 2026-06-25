export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
}

export interface LLMDelta {
  type: 'text' | 'tool_call' | 'done';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface LLMAdapter {
  streamChat(input: { system: string; messages: LLMMessage[]; tools?: unknown[] }): AsyncIterable<LLMDelta>;
}

export class LLMConfigError extends Error {
  constructor(message = 'Analytics unavailable - check LLM configuration') {
    super(message);
    this.name = 'LLMConfigError';
  }
}

export function createLLMAdapter(): LLMAdapter {
  const provider = env('ANALYTICS_LLM_PROVIDER');
  const model = env('ANALYTICS_LLM_MODEL');
  const apiKey = env('ANALYTICS_LLM_API_KEY');
  if (provider === 'test') return new TestAdapter(env('ANALYTICS_LLM_FAKE_RESPONSE') || 'Test analytics answer.');
  if (!provider || !model || !apiKey) throw new LLMConfigError();
  if (provider === 'openai') return new OpenAIAdapter(model, apiKey);
  if (provider === 'anthropic') return new AnthropicAdapter(model, apiKey);
  throw new LLMConfigError(`Unknown analytics LLM provider: ${provider}`);
}

function env(name: string): string {
  return String((import.meta as any).env?.[name] ?? process.env[name] ?? '').trim();
}

class TestAdapter implements LLMAdapter {
  constructor(private response: string) {}

  async *streamChat(): AsyncIterable<LLMDelta> {
    const chunks = this.response.match(/.{1,16}/g) ?? [''];
    for (const text of chunks) {
      if (text) yield { type: 'text', text };
    }
    yield { type: 'done' };
  }
}

class OpenAIAdapter implements LLMAdapter {
  constructor(private model: string, private apiKey: string) {}

  async *streamChat(input: { system: string; messages: LLMMessage[] }): AsyncIterable<LLMDelta> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: [{ role: 'system', content: input.system }, ...input.messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content }))],
      }),
    });
    if (!res.ok || !res.body) throw new Error('LLM provider request failed');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.delta?.content;
          if (text) yield { type: 'text', text };
        } catch {
          // Ignore malformed stream fragments.
        }
      }
    }
    yield { type: 'done' };
  }
}

class AnthropicAdapter implements LLMAdapter {
  constructor(private model: string, private apiKey: string) {}

  async *streamChat(input: { system: string; messages: LLMMessage[] }): AsyncIterable<LLMDelta> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        stream: true,
        system: input.system,
        messages: input.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });
    if (!res.ok || !res.body) throw new Error('LLM provider request failed');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const json = JSON.parse(line.slice(5).trim());
          const text = json.delta?.text;
          if (text) yield { type: 'text', text };
        } catch {
          // Ignore malformed stream fragments.
        }
      }
    }
    yield { type: 'done' };
  }
}
