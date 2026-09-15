/**
 * What a button tap does.
 *
 * Everything here runs *after* the webhook has authenticated the update and
 * resolved the tapper to an admin — see `src/pages/api/telegram/webhook.ts`.
 * This module assumes an authorized actor and concerns itself with turning one
 * callback into one call to the shared change functions.
 *
 * It never reimplements a rule. `applyStatusChange` and `applyPaymentChange` own
 * the transition matrix, the capacity check, the ledger and the compare-and-swap;
 * a tap is just another caller, and a refusal comes back as the same message an
 * admin would see in the browser.
 */
import { getDb } from './db';
import { applyStatusChange, type ActorRef } from './registrationStatusChange';
import { applyPaymentChange } from './registrationPaymentChange';
import { parseCallbackData, type Callback } from './telegramKeyboard';
import { answerCallbackQuery, formatIndiaTimestamp, refreshRegistrationMessages, showMenu } from './telegram';
import { paymentStatusLabel } from './registrationStatus';

interface CallbackQuery {
  id: string;
  data?: string;
  from?: { id?: number | string; first_name?: string; username?: string };
  message?: { message_id?: number | string; chat?: { id?: number | string } };
}

/** Who tapped, for the line appended to the group message. */
const actorName = (actor: ActorRef & { displayName?: string | null }, from?: CallbackQuery['from']) =>
  actor.displayName || actor.email?.split('@')[0] || from?.first_name || 'admin';

/**
 * Stable per (message, action) rather than per tap, so a double-tap — two ops
 * reacting to the same ping — replays into the existing idempotency key instead
 * of writing a second payment event.
 */
const requestIdFor = (chatId: unknown, messageId: unknown, cb: Callback) =>
  `telegram:${chatId}:${messageId}:${cb.verb}:${cb.arg}`;

export interface HandledCallback {
  /** Shown as the toast on the tapper's device. */
  toast: string;
  /** Appended to every message for this booking, when something changed. */
  footer?: string;
  changed: boolean;
}

async function runCallback(
  cb: Callback,
  query: CallbackQuery,
  actor: ActorRef & { displayName?: string | null },
): Promise<HandledCallback> {
  const db = getDb();
  const reg = db.prepare(
    'SELECT id, status, payment_status, trip_slug, amount_paid, total_amount FROM registrations WHERE id=?',
  ).get(cb.regId) as {
    id: number; status: string | null; payment_status: string | null;
    trip_slug: string | null; amount_paid: number | null; total_amount: number | null;
  } | undefined;
  if (!reg) return { toast: 'That booking no longer exists.', changed: false };

  const messageId = query.message?.message_id;
  const ctx = {
    regId: reg.id,
    status: String(reg.status ?? 'pending'),
    paymentStatus: reg.payment_status,
    tripSlug: reg.trip_slug,
    amountPaid: reg.amount_paid,
    totalAmount: reg.total_amount,
  };

  // A menu is pure navigation — it edits the keyboard and touches nothing.
  if (cb.verb === 'm') {
    if (messageId) await showMenu(String(messageId), ctx, cb.arg === 'confirm' || cb.arg === 'cancel' ? cb.arg : 'root');
    return { toast: '', changed: false };
  }

  const requestId = requestIdFor(query.message?.chat?.id, messageId, cb);
  const when = formatIndiaTimestamp(new Date());
  const who = actorName(actor, query.from);
  const paid = Number(reg.amount_paid) || 0;

  if (cb.verb === 'pay') {
    // The only payment move a button can express: record the outstanding balance.
    if (cb.arg !== 'full') return { toast: 'Unsupported payment action.', changed: false };
    try {
      const result = await applyPaymentChange({
        id: reg.id, action: 'full', requestedAmount: null,
        receivedAt: new Date().toISOString(), method: 'bank_transfer',
        requestId, bulk: false,
      }, actor);
      if (result.duplicate) return { toast: 'Already recorded.', changed: false };
      return {
        toast: 'Recorded as fully paid.',
        footer: `✅ Fully paid · ${who} · ${when}`,
        changed: true,
      };
    } catch (error: any) {
      return { toast: String(error?.message || 'Could not record the payment.'), changed: false };
    }
  }

  let input: Parameters<typeof applyStatusChange>[0];
  let done: string;

  if (cb.verb === 'st') {
    input = { id: reg.id, status: cb.arg, requestId };
    done = `↪ ${cb.arg}`;
  } else if (cb.verb === 'cf') {
    input = { id: reg.id, status: 'confirmed', paymentStatus: cb.arg, requestId };
    done = `✅ Confirmed · ${paymentStatusLabel(cb.arg)}`;
  } else if (cb.verb === 'cx') {
    // A full refund of nothing is not a refund. Cancelling an unpaid booking
    // takes the plain path, which is also what the admin UI does.
    const refund = cb.arg === 'full_refund' && paid > 0 ? { kind: 'full', amount: paid } : undefined;
    input = { id: reg.id, status: 'cancelled', requestId, refund };
    done = refund ? `✖ Cancelled · full refund ₹${paid.toLocaleString('en-IN')}` : '✖ Cancelled · no refund';
  } else {
    return { toast: 'Unsupported action.', changed: false };
  }

  const result = await applyStatusChange(input, actor);
  if (!result.ok) return { toast: result.error, changed: false };
  if (result.noop) return { toast: 'Already in that state.', changed: false };
  return { toast: done.replace(/^[^ ]+ /, ''), footer: `${done} · ${who} · ${when}`, changed: true };
}

/**
 * Handle one authenticated, authorized callback query end to end.
 *
 * Telegram permits exactly ONE answer per callback query, which settles the
 * ordering: acknowledging first would spend it on "Working…" and leave no way to
 * tell the tapper *why* a refusal happened — and a refusal is the case that most
 * needs reading ("This tier is now full (12/12 confirmed)"). So the work runs
 * first and the answer carries the outcome.
 *
 * The cost is latency on the confirm path, which awaits a Zoho round-trip. If
 * the query expires before the answer lands, `answerCallbackQuery` swallows it
 * and the refreshed message still shows what happened — the tapper loses the
 * toast, not the result.
 */
export async function handleCallbackQuery(
  query: CallbackQuery,
  actor: ActorRef & { displayName?: string | null },
): Promise<void> {
  const cb = parseCallbackData(query.data);
  if (!cb) {
    await answerCallbackQuery(query.id, 'Unrecognised button.', true);
    return;
  }

  let outcome: HandledCallback;
  try {
    outcome = await runCallback(cb, query, actor);
  } catch (error: any) {
    console.error('[Telegram callback]', error);
    outcome = { toast: 'Something went wrong. Check the admin UI.', changed: false };
  }

  // A refusal is an alert the tapper has to dismiss; a success is a transient
  // toast, because the message itself already carries the outcome.
  await answerCallbackQuery(query.id, outcome.toast, !outcome.changed && Boolean(outcome.toast));

  if (outcome.changed) await refreshRegistrationMessages(cb.regId, outcome.footer);
}
