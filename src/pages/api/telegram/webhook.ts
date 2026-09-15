/**
 * Telegram webhook — the only way an action gets in from the ops group.
 *
 * Three independent checks gate every update, and all three must pass:
 *
 *   1. The `X-Telegram-Bot-Api-Secret-Token` header, compared in constant time.
 *      Its own secret, not the bot token — the token already authenticates the
 *      retry worker, and one compromise should not be two.
 *   2. The chat. Only the configured ops group can act; anything from another
 *      chat is ignored.
 *   3. The tapper. `callback_query.from.id` is trustworthy — it reaches us
 *      through this authenticated webhook, not from the client — but it is not
 *      an authorization on its own, because the bot posts into a *group* and
 *      anyone in it can tap. It has to resolve to a linked admin holding
 *      owner/ops, read fresh from user_roles on every tap.
 *
 * `callback_data` is NOT a fourth check. It is echoed back by the client, so a
 * modified client can send any payload for a message it can see. It is parsed,
 * then re-validated through the same guards the admin UI goes through.
 *
 * This endpoint always answers 200. A non-2xx makes Telegram redeliver the
 * update, and redelivering a state change is worse than dropping one — the
 * update_id claim exists for the redeliveries that happen anyway.
 */
import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { logAction } from '../../../lib/audit';
import {
  answerCallbackQuery,
  telegramActionsConfigured,
  telegramAdminChatId,
  telegramWebhookSecret,
  sendDirectMessage,
} from '../../../lib/telegram';
import { claimUpdateId, consumeLinkToken, resolveTelegramActor } from '../../../lib/telegramLink';
import { handleCallbackQuery } from '../../../lib/telegramActions';

/** Roles allowed to move a booking — the same policy the admin endpoints enforce. */
const ALLOWED_ROLES = ['owner', 'ops'];

const ok = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

function secretValid(request: Request): boolean {
  const expected = telegramWebhookSecret();
  const supplied = String(request.headers.get('x-telegram-bot-api-secret-token') || '');
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/**
 * `/start <token>` in a direct message binds that Telegram account to the admin
 * who minted the token. Only ever handled in a private chat: a token pasted into
 * the group would be readable by everyone in it.
 */
async function handleStart(message: any): Promise<void> {
  const chatId = message?.chat?.id;
  const isPrivate = message?.chat?.type === 'private';
  const text = String(message?.text || '');
  const match = /^\/start(?:@\S+)?\s+(\S+)$/.exec(text.trim());
  if (!isPrivate || !chatId) return;

  if (!match) {
    await sendDirectMessage(chatId, 'Open the link from Admin → Settings → Telegram to connect this account.');
    return;
  }

  const from = message?.from ?? {};
  const result = consumeLinkToken(match[1], String(from.id), from.username ?? null);
  if (!result.ok) {
    const reason = result.reason === 'expired'
      ? 'That link has expired. Generate a new one in Admin → Settings → Telegram.'
      : result.reason === 'already_used'
        ? 'That link has already been used. Generate a new one if you need to reconnect.'
        : 'That link is not valid. Generate a new one in Admin → Settings → Telegram.';
    await sendDirectMessage(chatId, reason);
    return;
  }

  logAction({
    actorUserId: result.userId,
    action: 'telegram.linked',
    targetType: 'user',
    targetId: result.userId,
    newValue: { telegram_user_id: String(from.id), telegram_username: from.username ?? undefined },
  });
  await sendDirectMessage(chatId, 'Connected. You can now action bookings from the ops group.');
}

export const POST: APIRoute = async ({ request }) => {
  if (!telegramActionsConfigured() || !secretValid(request)) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let update: any;
  try {
    update = await request.json();
  } catch {
    return ok();
  }

  // Claimed before anything acts on it, so a redelivery is a no-op.
  if (!claimUpdateId(Number(update?.update_id))) return ok();

  try {
    if (update?.message) {
      await handleStart(update.message);
      return ok();
    }

    const query = update?.callback_query;
    if (!query?.id) return ok();

    if (String(query.message?.chat?.id ?? '') !== telegramAdminChatId()) {
      await answerCallbackQuery(query.id, 'Not available here.', true);
      return ok();
    }

    const actor = resolveTelegramActor(query.from?.id);
    if (!actor) {
      await answerCallbackQuery(
        query.id,
        'Your Telegram account is not connected to an admin. Connect it in Admin → Settings → Telegram.',
        true,
      );
      return ok();
    }
    if (!ALLOWED_ROLES.includes(actor.role)) {
      await answerCallbackQuery(query.id, 'Your role cannot change bookings.', true);
      return ok();
    }

    await handleCallbackQuery(query, {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      displayName: actor.displayName,
    });
  } catch (error) {
    // Never surface a 500: Telegram would redeliver the same state change.
    console.error('[telegram webhook]', error);
  }

  return ok();
};
