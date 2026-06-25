import type { APIRoute } from 'astro';
import { createLLMAdapter, LLMConfigError, type LLMMessage, type LLMToolCall } from '../../../../lib/analytics/llm';
import { buildAnalyticsSystemPrompt } from '../../../../lib/analytics/prompt';
import { analyzeCustomQuery, customQueryToolSchema, type StructuredAnalyticsQuery } from '../../../../lib/analytics/customQuery';
import { defaultSuggestions, getTool, namedToolSchemas, type ToolResult } from '../../../../lib/analytics/tools';
import { appendAnalyticsMessage, createOrLoadSession, loadAnalyticsHistory, writeAnalyticsAudit } from '../../../../lib/analytics/sessions';

export const prerender = false;

// Wall-clock budget for the whole turn (LLM round-trips + tool execution).
const TURN_DEADLINE_MS = 45_000;     // whole-turn wall clock (LLM round-trips + tools)
const PER_CALL_DEADLINE_MS = 20_000; // cap on a single LLM stream, so later rounds aren't starved
const MAX_TOOL_ROUNDS = 5;

interface ChatRequest {
  message?: string;
  conversationId?: string;
  selection?: { type: 'trip' | 'departure'; id: string };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const adminUser = locals.adminUser;
  if (!adminUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (adminUser.role !== 'owner') return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const message = String(body.message ?? '').trim();
  if (!message) return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 });

  const sessionId = createOrLoadSession(adminUser.userId, body.conversationId);
  appendAnalyticsMessage({ sessionId, role: 'user', content: message });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      const remaining = () => TURN_DEADLINE_MS - (Date.now() - started);
      let auditWritten = false;
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const audit = (input: Partial<Parameters<typeof writeAnalyticsAudit>[0]>) => {
        if (auditWritten) return;
        auditWritten = true;
        writeAnalyticsAudit({ ...input, sessionId, ownerId: adminUser.userId, prompt: message, durationMs: Date.now() - started });
      };

      // Tracked across tool rounds for the final event + audit row.
      let answer = '';
      let lastData: ToolResult | null = null;
      let toolTier: 'named' | 'escape_hatch' | null = null;
      let lastToolName: string | null = null;
      let lastToolInput: unknown = null;
      let piiAttemptDetected = false;

      try {
        const adapter = createLLMAdapter();
        const tools = [...namedToolSchemas(), customQueryToolSchema];
        const system = buildAnalyticsSystemPrompt();

        const history = loadAnalyticsHistory(sessionId)
          .slice(0, -1) // drop the user turn we just appended; it is added explicitly below
          .map(toLlmMessage);
        const messages: LLMMessage[] = [...history, { role: 'user', content: message }];
        if (body.selection) {
          messages.push({
            role: 'user',
            content: `The owner selected ${body.selection.type} "${body.selection.id}". Use it directly as a filter and do not ask to disambiguate again.`,
          });
        }

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (remaining() <= 0) return finishTimeout();

          const pending: LLMToolCall[] = [];
          let turnText = '';
          // Buffer text instead of streaming: text from tool rounds is just
          // narration. Reset each round so only the terminal (non-tool) round's
          // text survives, and emit it once in the final event - no live typing
          // of the model thinking out loud.
          answer = '';
          const signal = AbortSignal.timeout(Math.min(remaining(), PER_CALL_DEADLINE_MS));
          try {
            for await (const delta of adapter.streamChat({ system, messages, tools, signal })) {
              if (delta.type === 'text' && delta.text) {
                turnText += delta.text;
                answer += delta.text;
              } else if (delta.type === 'tool_call' && delta.toolCall) {
                pending.push(delta.toolCall);
              }
            }
          } catch (error: any) {
            if (error instanceof LLMConfigError) throw error;
            if (isAbort(error)) return finishTimeout();
            // Provider/network failure mid-turn: degrade gracefully if a tool already ran.
            if (lastData) {
              answer = composeFallbackAnswer(message, lastData);
              break;
            }
            throw error;
          }

          if (!pending.length) break; // model produced its final answer

          messages.push({ role: 'assistant', content: turnText, toolCalls: pending });

          for (const call of pending) {
            toolTier = call.name === 'analyzeCustomQuery' ? 'escape_hatch' : 'named';
            lastToolName = call.name;
            lastToolInput = call.name === 'analyzeCustomQuery' ? sanitizeAuditInput(call.input as unknown as StructuredAnalyticsQuery) : call.input;

            const { result, piiAttempt } = runTool(call.name, call.input, body.selection);
            piiAttemptDetected = piiAttemptDetected || piiAttempt;

            if (result.needsSelection) {
              appendAnalyticsMessage({ sessionId, role: 'tool', toolName: call.name, toolInput: lastToolInput, toolOutput: result });
              send('final', { conversationId: sessionId, needsSelection: result.needsSelection, suggestedQuestions: defaultSuggestions() });
              audit({ toolTier, toolName: call.name, toolInput: lastToolInput, ambiguityResolved: false, resultRowCount: result.needsSelection.options.length });
              controller.close();
              return;
            }

            lastData = result;
            appendAnalyticsMessage({ sessionId, role: 'tool', toolName: call.name, toolInput: lastToolInput, toolOutput: result });
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: JSON.stringify({ summary: result.summary, columns: result.columns, rows: result.rows.slice(0, 50) }),
            });
          }
        }

        if (!answer.trim() && lastData) {
          answer = composeFallbackAnswer(message, lastData);
        }

        appendAnalyticsMessage({ sessionId, role: 'assistant', content: answer });
        send('final', {
          conversationId: sessionId,
          answer,
          suggestedQuestions: defaultSuggestions().slice(0, 3),
        });
        audit({
          toolTier,
          toolName: lastToolName,
          toolInput: lastToolInput,
          piiAttemptDetected,
          ambiguityResolved: Boolean(body.selection),
          selectionMade: body.selection ?? null,
          resultRowCount: lastData?.rows.length ?? null,
        });
        controller.close();
        return;

        function finishTimeout() {
          const error = 'Query timed out. Try a more specific question.';
          send('final', { conversationId: sessionId, error, suggestedQuestions: defaultSuggestions() });
          audit({ toolTier, toolName: lastToolName, toolInput: lastToolInput, piiAttemptDetected, error });
          controller.close();
        }
      } catch (error: any) {
        const isConfig = error instanceof LLMConfigError;
        const msg = isConfig ? 'Analytics unavailable - check LLM configuration' : String(error?.message || 'Something went wrong. Try again.');
        send('final', { conversationId: sessionId, error: msg, suggestedQuestions: defaultSuggestions() });
        appendAnalyticsMessage({ sessionId, role: 'assistant', content: msg });
        audit({ toolTier, toolName: lastToolName, toolInput: lastToolInput, piiAttemptDetected: piiAttemptDetected || Boolean(error?.piiAttemptDetected), error: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};

function runTool(name: string, input: Record<string, unknown>, selection?: { type: 'trip' | 'departure'; id: string }): { result: ToolResult; piiAttempt: boolean } {
  const merged: Record<string, any> = { ...input };
  if (selection?.type === 'trip' && merged.tripSlug == null) merged.tripSlug = selection.id;
  if (selection?.type === 'departure' && merged.departureId == null) merged.departureId = selection.id;

  if (name === 'analyzeCustomQuery') {
    const result = analyzeCustomQuery(merged as StructuredAnalyticsQuery);
    return { result: { columns: result.columns, rows: result.rows, summary: result.summary }, piiAttempt: result.piiAttemptDetected };
  }
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown analytics tool: ${name}`);
  return { result: tool.execute(merged), piiAttempt: false };
}

function toLlmMessage(row: { role: string; content: string }): LLMMessage {
  return { role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content };
}

function isAbort(error: any): boolean {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

function composeFallbackAnswer(message: string, result: ToolResult): string {
  const rowCount = result.rows.length;
  const preview = result.rows.slice(0, 3).map((row) => result.columns.map((column, i) => `${column}: ${row[i]}`).join(', ')).join('; ');
  return `${result.summary} I found ${rowCount} row${rowCount === 1 ? '' : 's'}${preview ? `: ${preview}` : ''}.`;
}

function sanitizeAuditInput(input: StructuredAnalyticsQuery): Record<string, unknown> {
  return {
    intent: input.intent,
    tables: input.tables,
    select: input.select?.map(({ table, column, alias, aggregation }) => ({ table, column, alias, aggregation })),
    filters: input.filters?.map(({ table, column, operator }) => ({ table, column, operator })),
    groupBy: input.groupBy,
    orderBy: input.orderBy,
    joins: input.joins,
    limit: input.limit,
  };
}
