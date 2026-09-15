/**
 * Inline keyboards for the ops group, and the callback payloads they carry.
 *
 * Pure functions, no I/O — the webhook is the only thing that acts on what these
 * describe, and it re-validates every action through `assertTransition` /
 * `assertPaymentActionAllowed` anyway.
 *
 * That re-validation is not belt-and-braces. `callback_data` is echoed back by
 * the *client*, so a modified Telegram client can send any payload it likes for
 * a message it can see. Nothing here is a security boundary; it decides what the
 * ops group is offered, not what the server will accept.
 *
 * Keyboards are derived from TRANSITIONS and PAYMENT_OPTIONS so a button can
 * never offer a move the server refuses.
 */
import { siteUrl } from './siteUrl';
import { assertTransition, PAYMENT_OPTIONS } from './registrationStatus';

export type Menu = 'root' | 'confirm' | 'cancel';

/**
 * Statuses whose message carries no action at all, whatever the transition
 * guards would allow — moves on these are made in the admin UI.
 */
const NO_ACTION_STATUSES = new Set(['lead', 'confirmed']);

/** `b:<registration id>:<verb>:<arg>` — well inside Telegram's 64-byte cap. */
export type Verb = 'st' | 'cf' | 'cx' | 'pay' | 'm';

export interface Callback {
  regId: number;
  verb: Verb;
  arg: string;
}

const VERBS: readonly Verb[] = ['st', 'cf', 'cx', 'pay', 'm'];

export function callbackData(regId: number, verb: Verb, arg = ''): string {
  return `b:${regId}:${verb}:${arg}`;
}

export function parseCallbackData(data: unknown): Callback | null {
  const parts = String(data ?? '').split(':');
  if (parts.length !== 4 || parts[0] !== 'b') return null;
  const regId = Number(parts[1]);
  if (!Number.isInteger(regId) || regId <= 0) return null;
  const verb = parts[2] as Verb;
  if (!VERBS.includes(verb)) return null;
  if (!/^[a-z_]*$/.test(parts[3])) return null;
  return { regId, verb, arg: parts[3] };
}

interface Button { text: string; callback_data?: string; url?: string }

export interface KeyboardContext {
  regId: number;
  status: string;
  tripSlug?: string | null;
  /** Needed to decide a move: several transition guards turn on the money. */
  amountPaid?: number | null;
  totalAmount?: number | null;
}

/**
 * Would this move actually be allowed?
 *
 * Asks `assertTransition` rather than checking that TRANSITIONS has the key,
 * because having the key is not the same as being possible: `cancelled → lead`
 * and `cancelled → pending` both exist, and both refuse unconditionally with
 * "Re-instate via Confirm for a cancelled booking". Keying off presence put two
 * buttons on every cancelled booking that could only ever produce an error.
 *
 * Guards also turn on the row's money — `lead → pending` refuses once an advance
 * is recorded, and confirming needs a trip price — so the real amounts go in.
 * Confirming is probed with `advance_paid`, since the payment is chosen in the
 * submenu the root button opens, not by the root button itself.
 */
function canMoveTo(ctx: KeyboardContext, to: string): boolean {
  // assertTransition treats from === to as a no-op success, which would put a
  // "Cancel ▸" on an already-cancelled booking.
  if (to === ctx.status) return false;
  const totalRaw = Number(ctx.totalAmount);
  try {
    assertTransition(ctx.status, to, {
      amountPaid: Number(ctx.amountPaid) || 0,
      totalAmount: Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null,
      requestedPaymentStatus: to === 'confirmed' ? 'advance_paid' : undefined,
    });
    return true;
  } catch {
    return false;
  }
}

function openButton(ctx: KeyboardContext): Button {
  const path = ctx.tripSlug ? `/admin/registrations/${ctx.tripSlug}` : '/admin/registrations';
  return { text: 'Open in admin ↗', url: siteUrl(path) };
}

/**
 * The keyboard for a booking as it stands. A row with no move left to offer
 * keeps only the link out to the admin UI.
 */
export function keyboardFor(ctx: KeyboardContext, menu: Menu = 'root'): { inline_keyboard: Button[][] } {
  const { regId, status } = ctx;
  const rows: Button[][] = [];

  if (menu === 'confirm') {
    const options = (PAYMENT_OPTIONS.confirmed ?? []).filter((p) => p === 'advance_paid' || p === 'fully_paid');
    rows.push(options.map((p) => ({
      text: p === 'fully_paid' ? 'Fully paid' : 'Advance paid',
      callback_data: callbackData(regId, 'cf', p),
    })));
    rows.push([{ text: '← Back', callback_data: callbackData(regId, 'm', 'root') }]);
    return { inline_keyboard: rows };
  }

  if (menu === 'cancel') {
    // Partial refunds need an amount, which a button cannot carry — those go to
    // the admin UI. `no_refund` and `full_refund` are the two that do not.
    rows.push([
      { text: 'Cancel · no refund', callback_data: callbackData(regId, 'cx', 'no_refund') },
      { text: 'Cancel · full refund', callback_data: callbackData(regId, 'cx', 'full_refund') },
    ]);
    rows.push([{ text: '← Back', callback_data: callbackData(regId, 'm', 'root') }]);
    return { inline_keyboard: rows };
  }

  // A lead is still a conversation and a confirmed booking is already settled;
  // the ops group wants no one-tap move on either, so those messages keep just
  // the link out. Every other status is offered whatever the guards allow.
  if (NO_ACTION_STATUSES.has(status)) return { inline_keyboard: [[openButton(ctx)]] };

  const primary: Button[] = [];
  if (canMoveTo(ctx, 'pending')) {
    primary.push({ text: '→ Pending', callback_data: callbackData(regId, 'st', 'pending') });
  }
  if (canMoveTo(ctx, 'confirmed')) {
    primary.push({ text: 'Confirm ▸', callback_data: callbackData(regId, 'm', 'confirm') });
  }
  if (primary.length) rows.push(primary);

  if (canMoveTo(ctx, 'cancelled')) {
    rows.push([{ text: 'Cancel ▸', callback_data: callbackData(regId, 'm', 'cancel') }]);
  }

  rows.push([openButton(ctx)]);
  return { inline_keyboard: rows };
}
