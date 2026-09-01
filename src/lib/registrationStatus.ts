// Single source of truth for registration status + payment_status:
// the transition matrix the admin endpoint enforces, and the colour/label
// maps shared by the server render and the client <script>.

export const REG_STATUSES = ['wishlist', 'lead', 'pending', 'confirmed', 'rejected', 'cancelled'] as const;
export type RegStatus = (typeof REG_STATUSES)[number];

export const ADMIN_SETTABLE_STATUSES = ['lead', 'pending', 'confirmed', 'rejected', 'cancelled'] as const;

export const PAYMENT_STATUSES = ['unpaid', 'advance_paid', 'fully_paid', 'partial_refund', 'full_refund'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_PAYMENT_STATUSES = ['partial_refund', 'full_refund'] as const;
export const CONFIRMED_PAYMENT_STATUSES = ['advance_paid', 'fully_paid'] as const;

export interface TransitionCtx {
  amountPaid: number;
  totalAmount: number | null;
  requestedPaymentStatus?: string;
}
type Guard = (ctx: TransitionCtx) => string | null;

const OK: Guard = () => null;

const needsConfirmPayment: Guard = (ctx) => {
  if (!(CONFIRMED_PAYMENT_STATUSES as readonly string[]).includes(String(ctx.requestedPaymentStatus))) {
    return 'Choose whether the advance or the full payment was received.';
  }
  if (!(Number.isInteger(ctx.totalAmount) && (ctx.totalAmount as number) > 0)) {
    return 'Set the trip price on this registration before confirming.';
  }
  return null;
};

const mustBeUnpaid: Guard = (ctx) =>
  ctx.amountPaid > 0 ? 'Cancel and record any refund first.' : null;

const reinstateViaConfirm: Guard = () => 'Re-instate via Confirm for a cancelled booking.';

// wishlist + lead share the same outbound rules.
const LEAD_LIKE: Record<string, Guard> = {
  pending: mustBeUnpaid,
  confirmed: needsConfirmPayment,
  rejected: mustBeUnpaid,
  cancelled: () => "Use Reject for a lead that won't proceed.",
};

export const TRANSITIONS: Record<string, Record<string, Guard>> = {
  wishlist: { ...LEAD_LIKE },
  lead: { ...LEAD_LIKE },
  pending: {
    lead: mustBeUnpaid,
    confirmed: needsConfirmPayment,
    rejected: mustBeUnpaid,
    cancelled: OK,
  },
  confirmed: {
    cancelled: OK,
    rejected: () => 'Use Cancel to void a confirmed booking.',
  },
  rejected: {
    lead: mustBeUnpaid,
    pending: mustBeUnpaid,
    confirmed: needsConfirmPayment,
  },
  cancelled: {
    lead: reinstateViaConfirm,
    pending: reinstateViaConfirm,
    confirmed: needsConfirmPayment,
    rejected: reinstateViaConfirm,
  },
};

/** Throws with a client-safe message when `from → to` is not allowed. `from === to` is a no-op. */
export function assertTransition(from: string, to: string, ctx: TransitionCtx): void {
  if (from === to) return;
  if (!(ADMIN_SETTABLE_STATUSES as readonly string[]).includes(to)) {
    throw new Error(`"${to}" is not a status you can set here.`);
  }
  const guard = TRANSITIONS[from]?.[to];
  if (!guard) throw new Error(`Cannot change a registration from ${from} to ${to}.`);
  const problem = guard(ctx);
  if (problem) throw new Error(problem);
}

/**
 * Status pills. Each pair is a `--color-*-surface` plus the ink measured to be
 * readable on it; see the status badge palette in `src/styles/global.css` for
 * the ratios. These strings are inlined as `style=` on both the server render
 * and the client script, which is why they are custom properties rather than
 * Tailwind classes — there is no class list to extend at that point.
 */
export const REG_STATUS_COLORS: Record<string, string> = {
  confirmed: 'background:var(--color-success-surface);color:var(--color-success-surface-ink);',
  rejected: 'background:var(--color-danger-surface);color:var(--color-danger-ink);',
  lead: 'background:var(--color-caution-surface);color:var(--color-caution-ink);',
  wishlist: 'background:var(--color-interest-surface);color:var(--color-interest-ink);',
  cancelled: 'background:var(--color-neutral-surface);color:var(--color-neutral-ink);',
  pending: 'background:var(--color-warning-surface);color:var(--color-warning-ink);',
};

/** Moved here from utils.ts so server + client can't drift. */
export function regStatusStyle(status: string): string {
  return REG_STATUS_COLORS[status] ?? REG_STATUS_COLORS.pending;
}

export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  unpaid: 'background:var(--color-danger-surface);color:var(--color-danger-ink);',
  advance_paid: 'background:var(--color-info-surface);color:var(--color-info-ink);',
  fully_paid: 'background:var(--color-success-surface);color:var(--color-success-surface-ink);',
  partial_refund: 'background:var(--color-warning-surface);color:var(--color-warning-ink);',
  full_refund: 'background:var(--color-neutral-surface);color:var(--color-neutral-ink);',
};

export function paymentStatusLabel(s: string): string {
  return (
    {
      unpaid: 'Unpaid',
      advance_paid: 'Advance paid',
      fully_paid: 'Fully paid',
      partial_refund: 'Partial refund',
      full_refund: 'Refunded',
    } as Record<string, string>
  )[s] ?? s;
}

export function paymentStatusStyle(s: string): string {
  return PAYMENT_STATUS_COLORS[s] ?? PAYMENT_STATUS_COLORS.unpaid;
}

/** Backfill helper: derive payment_status from the recorded amount vs the trip total. */
export function derivePaymentStatus(reg: { amount_paid?: unknown; total_amount?: unknown }): PaymentStatus {
  const paid = Number(reg.amount_paid) || 0;
  const total = Number(reg.total_amount);
  if (paid <= 0) return 'unpaid';
  if (Number.isFinite(total) && total > 0 && paid >= total) return 'fully_paid';
  return 'advance_paid';
}

/** DEV-only post-write consistency check; skipped for refund states. */
export function assertPaymentStatusConsistent(reg: {
  id?: unknown;
  amount_paid?: unknown;
  total_amount?: unknown;
  payment_status?: string;
}): void {
  try {
    if (!(import.meta as any).env?.DEV) return;
  } catch {
    return;
  }
  const stored = reg.payment_status;
  if (stored && (REFUND_PAYMENT_STATUSES as readonly string[]).includes(stored)) return;
  const derived = derivePaymentStatus(reg);
  if (stored !== derived) {
    console.warn(`[payment_status] stored=${stored} derived=${derived} for registration ${reg.id}`);
  }
}
