import { routeNamedTool } from './tools';

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: LLMToolCall[]; // present on assistant turns that requested tools
  toolCallId?: string; // present on tool-result turns
  toolName?: string; // present on tool-result turns
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMDelta {
  type: 'text' | 'tool_call' | 'done';
  text?: string;
  toolCall?: LLMToolCall;
}

export interface StreamChatInput {
  system: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  signal?: AbortSignal;
}

export interface LLMAdapter {
  streamChat(input: StreamChatInput): AsyncIterable<LLMDelta>;
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

function lastUserText(messages: LLMMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

/**
 * Deterministic adapter for tests. When tools are offered and no tool result is
 * present yet, it mirrors the keyword router to request one tool — exercising the
 * real agentic loop. Once a tool result exists (or no tools are offered) it
 * streams the canned text answer.
 */
class TestAdapter implements LLMAdapter {
  constructor(private response: string) {}

  async *streamChat(input: StreamChatInput): AsyncIterable<LLMDelta> {
    const toolsOffered = (input.tools?.length ?? 0) > 0;
    const hasToolResult = input.messages.some((m) => m.role === 'tool');
    if (toolsOffered && !hasToolResult) {
      const routed = routeNamedTool(lastUserText(input.messages));
      yield { type: 'tool_call', toolCall: { id: 'test_call_1', name: routed.name, input: routed.input } };
      yield { type: 'done' };
      return;
    }
    const chunks = this.response.match(/.{1,16}/g) ?? [''];
    for (const text of chunks) {
      if (text) yield { type: 'text', text };
    }
    yield { type: 'done' };
  }
}

class OpenAIAdapter implements LLMAdapter {
  constructor(private model: string, private apiKey: string) {}

  async *streamChat(input: StreamChatInput): AsyncIterable<LLMDelta> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: toOpenAIMessages(input.system, input.messages),
        ...(input.tools?.length
          ? { tools: input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      }),
    });
    if (!res.ok || !res.body) throw new Error('LLM provider request failed');
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of sseData(res.body)) {
      if (data === '[DONE]') continue;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = json.choices?.[0];
      const text = choice?.delta?.content;
      if (text) yield { type: 'text', text };
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const slot = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        toolAcc.set(tc.index, slot);
      }
    }
    for (const slot of toolAcc.values()) {
      if (slot.name) yield { type: 'tool_call', toolCall: { id: slot.id || slot.name, name: slot.name, input: safeJson(slot.args) } };
    }
    yield { type: 'done' };
  }
}

class AnthropicAdapter implements LLMAdapter {
  constructor(private model: string, private apiKey: string) {}

  async *streamChat(input: StreamChatInput): AsyncIterable<LLMDelta> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: input.signal,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        stream: true,
        system: input.system,
        messages: toAnthropicMessages(input.messages),
        ...(input.tools?.length ? { tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      }),
    });
    if (!res.ok || !res.body) throw new Error('LLM provider request failed');
    const toolSlots = new Map<number, { id: string; name: string; json: string }>();
    for await (const data of sseData(res.body)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
        toolSlots.set(json.index, { id: json.content_block.id, name: json.content_block.name, json: '' });
        continue;
      }
      if (json.type === 'content_block_delta' || json.type === undefined) {
        if (json.delta?.type === 'input_json_delta' && json.delta.partial_json != null) {
          const slot = toolSlots.get(json.index);
          if (slot) slot.json += json.delta.partial_json;
          continue;
        }
        const text = json.delta?.text;
        if (text) yield { type: 'text', text };
        continue;
      }
      if (json.type === 'content_block_stop') {
        const slot = toolSlots.get(json.index);
        if (slot?.name) yield { type: 'tool_call', toolCall: { id: slot.id, name: slot.name, input: safeJson(slot.json) } };
      }
    }
    yield { type: 'done' };
  }
}

function toOpenAIMessages(system: string, messages: LLMMessage[]): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input) } })),
      });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return out;
}

function toAnthropicMessages(messages: LLMMessage[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return out;
}

/** Yields the payload of each `data:` line from an SSE byte stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
      }
    }
  }
}

function safeJson(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
