import type { APIRoute } from 'astro';
import { requireRole } from '../../../lib/requireRole';
import { sendTestNotification } from '../../../lib/telegram';

export const POST: APIRoute = async ({ locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const result = await sendTestNotification();
    if (!result.configured) {
      return new Response(JSON.stringify({ configured: false }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ configured: true, messageId: result.messageId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ configured: true, error: 'Telegram delivery failed.' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
};
