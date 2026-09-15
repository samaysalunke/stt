/**
 * Connect (or disconnect) the signed-in admin's own Telegram account.
 *
 * Deliberately self-service only: there is no way to link *someone else's*
 * account, because the whole point of the token round-trip is to prove that the
 * person holding the admin session also controls that Telegram account.
 */
import type { APIRoute } from 'astro';
import { jsonOk as json } from '../../../lib/apiResponse';
import { requireRole } from '../../../lib/requireRole';
import { logAction } from '../../../lib/audit';
import { telegramBotUsername, telegramActionsConfigured } from '../../../lib/telegram';
import { createLinkToken, linkForUser, revokeLinkForUser } from '../../../lib/telegramLink';

export const POST: APIRoute = async ({ request, locals }) => {
  // Only the roles that can actually move a booking may hold a link.
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const admin = locals.adminUser!;

  try {
    const body = await request.json().catch(() => ({}));
    const action = String((body as any)?.action || 'create');

    if (action === 'revoke') {
      const removed = revokeLinkForUser(admin.userId);
      if (removed) {
        logAction({
          actorUserId: admin.userId, actorEmail: admin.email, actorRole: admin.role,
          action: 'telegram.unlinked', targetType: 'user', targetId: admin.userId,
        });
      }
      return json({ success: true, linked: false });
    }

    if (action !== 'create') return json({ success: false, error: 'Unknown action.' }, 400);

    if (!telegramActionsConfigured()) {
      return json({ success: false, error: 'Telegram actions are not configured on this server.' }, 400);
    }
    const bot = telegramBotUsername();
    if (!bot) return json({ success: false, error: 'TELEGRAM_BOT_USERNAME is not set.' }, 400);

    const token = createLinkToken(admin.userId);
    return json({
      success: true,
      url: `https://t.me/${bot}?start=${token}`,
      expiresInMinutes: 10,
      current: linkForUser(admin.userId),
    });
  } catch (err) {
    console.error('[telegram-link]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};

export const GET: APIRoute = async ({ locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  return json({
    success: true,
    configured: telegramActionsConfigured() && Boolean(telegramBotUsername()),
    link: linkForUser(locals.adminUser!.userId),
  });
};
