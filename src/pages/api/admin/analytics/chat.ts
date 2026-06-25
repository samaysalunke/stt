import type { APIRoute } from 'astro';
import { createLLMAdapter, LLMConfigError } from '../../../../lib/analytics/llm';
import { buildAnalyticsSystemPrompt } from '../../../../lib/analytics/prompt';
import { analyzeCustomQuery, type StructuredAnalyticsQuery } from '../../../../lib/analytics/customQuery';
import { defaultSuggestions, getTool, routeNamedTool, tripOptionsForAmbiguousMessage, type ToolResult } from '../../../../lib/analytics/tools';
import { appendAnalyticsMessage, createOrLoadSession, loadAnalyticsHistory, writeAnalyticsAudit } from '../../../../lib/analytics/sessions';

export const prerender = false;

interface ChatRequest {
  message?: string;
  conversationId?: string;
  selection?: { type: 'trip' | 'departure'; id: string };
  customQuery?: StructuredAnalyticsQuery;
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
      let auditWritten = false;
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const audit = (input: Parameters<typeof writeAnalyticsAudit>[0]) => {
        if (auditWritten) return;
        auditWritten = true;
        writeAnalyticsAudit({ ...input, sessionId, ownerId: adminUser.userId, prompt: message, durationMs: Date.now() - started });
      };

      try {
        const ambiguity = !body.selection && /\b(for|in|on)\b/i.test(message) ? tripOptionsForAmbiguousMessage(message) : null;
        if (ambiguity) {
          const payload = { conversationId: sessionId, needsSelection: ambiguity, suggestedQuestions: defaultSuggestions() };
          send('final', payload);
          audit({ toolTier: 'named', toolName: 'findTripsByQuery', resultRowCount: ambiguity.options.length });
          controller.close();
          return;
        }

        let toolName: string;
        let toolInput: Record<string, any>;
        let toolResult: ToolResult;
        let toolTier: 'named' | 'escape_hatch' = 'named';
        let piiAttemptDetected = false;

        const timeoutAt = Date.now() + 10_000;
        if (body.customQuery) {
          toolTier = 'escape_hatch';
          toolName = 'analyzeCustomQuery';
          toolInput = sanitizeAuditInput(body.customQuery);
          const result = analyzeCustomQuery(body.customQuery);
          piiAttemptDetected = result.piiAttemptDetected;
          toolResult = { columns: result.columns, rows: result.rows, summary: result.summary };
        } else {
          const routed = routeNamedTool(message, body.selection);
          toolName = routed.name;
          toolInput = routed.input;
          const tool = getTool(toolName);
          if (!tool) throw new Error('Unknown analytics tool');
          toolResult = tool.execute(toolInput);
          if (toolResult.needsSelection) {
            const payload = { conversationId: sessionId, needsSelection: toolResult.needsSelection, suggestedQuestions: defaultSuggestions() };
            send('final', payload);
            audit({ toolTier, toolName, toolInput, resultRowCount: toolResult.rows.length });
            controller.close();
            return;
          }
        }

        if (Date.now() > timeoutAt) {
          const error = 'Query timed out. Try a more specific question.';
          send('final', { conversationId: sessionId, error, suggestedQuestions: defaultSuggestions() });
          audit({ toolTier, toolName, toolInput, piiAttemptDetected, error });
          controller.close();
          return;
        }

        appendAnalyticsMessage({ sessionId, role: 'tool', toolName, toolInput, toolOutput: toolResult });

        const answerPrompt = [
          message,
          '',
          `Tool used: ${toolName}`,
          `Tool summary: ${toolResult.summary}`,
          `Columns: ${toolResult.columns.join(', ')}`,
          `Rows JSON: ${JSON.stringify(toolResult.rows.slice(0, 50))}`,
          '',
          'Answer succinctly. Explain the calculation and mention the revenue definition when relevant. Do not expose PII.',
        ].join('\n');

        let answer = '';
        try {
          const adapter = createLLMAdapter();
          const history = loadAnalyticsHistory(sessionId).map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content }));
          for await (const delta of adapter.streamChat({
            system: buildAnalyticsSystemPrompt(),
            messages: [...history, { role: 'user', content: answerPrompt }],
          })) {
            if (delta.type === 'text' && delta.text) {
              answer += delta.text;
              send('token', { text: delta.text });
            }
          }
        } catch (error) {
          if (error instanceof LLMConfigError) throw error;
          answer = composeFallbackAnswer(message, toolResult);
          send('token', { text: answer });
        }

        appendAnalyticsMessage({ sessionId, role: 'assistant', content: answer });
        const payload = {
          conversationId: sessionId,
          answer,
          data: { columns: toolResult.columns, rows: toolResult.rows },
          suggestedQuestions: defaultSuggestions().slice(0, 3),
        };
        send('final', payload);
        audit({ toolTier, toolName, toolInput, piiAttemptDetected, resultRowCount: toolResult.rows.length });
        controller.close();
      } catch (error: any) {
        const isConfig = error instanceof LLMConfigError;
        const msg = isConfig ? 'Analytics unavailable - check LLM configuration' : String(error?.message || 'Something went wrong. Try again.');
        send('final', { conversationId: sessionId, error: msg, suggestedQuestions: defaultSuggestions() });
        appendAnalyticsMessage({ sessionId, role: 'assistant', content: msg });
        writeAnalyticsAudit({
          sessionId,
          ownerId: adminUser.userId,
          prompt: message,
          error: msg,
          piiAttemptDetected: Boolean(error?.piiAttemptDetected),
          durationMs: Date.now() - started,
        });
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
