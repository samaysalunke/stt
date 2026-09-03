// Single source of truth for registration status + payment_status:
// the transition matrix the admin endpoint enforces, and the colour/label
// maps shared by the server render and the client <script>.

// `rejected` was retired on 2026-09-03 and merged into `cancelled` — one
// terminal state, with the payment side saying what happened to the money.
// It stays in REG_STATUSES so a row that predates the migration still renders,
// and so the analytics//customers read paths that exclude it keep compiling.
export const REG_STATUSES = ['wishlist', 'lead', 'pending', 'confirmed', 'rejected', 'cancelled'] as const;
export type RegStatus = (typeof REG_STATUSES)[number];

export const ADMIN_SETTABLE_STATUSES = ['lead', 'pending', 'confirmed', 'cancelled'] as const;

export const PAYMENT_STATUSES = ['unpaid', 'advance_paid', 'fully_paid', 'partial_refund', 'full_refund', 'no_refund'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// States that describe the outcome of a cancellation rather than a position on
// the way to being paid. None of them can be re-derived from amount_paid alone,
// so the consistency check skips them.
export const REFUND_PAYMENT_STATUSES = ['partial_refund', 'full_refund', 'no_refund'] as const;
export const CONFIRMED_PAYMENT_STATUSES = ['advance_paid', 'fully_paid'] as const;

/**
 * The payment states an admin can choose for a row, by its status. Single
 * source of truth for both the per-row Payment select and the bulk bar — they
 * drifted apart once and that is the bug this closes.
 */
export const PAYMENT_OPTIONS: Record<string, readonly PaymentStatus[]> = {
  // A wishlist entry has no money attached and no payment control.
  wishlist: [],
  lead: ['unpaid'],
  pending: ['unpaid', 'advance_paid'],
  // `unpaid` stays on the confirmed list as the correction path for a mis-keyed
  // payment: confirmed → pending is not a legal transition, so without it a
  // wrong amount could never be reversed.
  confirmed: ['unpaid', 'advance_paid', 'fully_paid'],
  cancelled: ['no_refund', 'partial_refund', 'full_refund'],
  // Legacy rows only, until the merge migration has run against them.
  rejected: ['no_refund', 'partial_refund', 'full_refund'],
};

/**
 * Payment choices for a row, always including where the row actually is.
 *
 * Real data holds combinations the matrix does not offer — production has a
 * `lead` carrying a recorded advance. Dropping that value would make the select
 * misreport the row as Unpaid and, worse, read as an edit the moment the page
 * loads, putting a live payment one click from being reversed. Keep it listed.
 */
export function paymentOptionsFor(status: string, current?: string): readonly PaymentStatus[] {
  const base = PAYMENT_OPTIONS[status] ?? [];
  // A status with no payment control (wishlist) keeps none.
  if (!base.length || !current) return base;
  if (base.includes(current as PaymentStatus)) return base;
  return (PAYMENT_STATUSES as readonly string[]).includes(current)
    ? [current as PaymentStatus, ...base]
    : base;
}

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
  cancelled: OK,
};

export const TRANSITIONS: Record<string, Record<string, Guard>> = {
  wishlist: { ...LEAD_LIKE },
  lead: { ...LEAD_LIKE },
  pending: {
    lead: mustBeUnpaid,
    confirmed: needsConfirmPayment,
    cancelled: OK,
  },
  confirmed: {
    cancelled: OK,
  },
  // Inbound only — nothing can be set to `rejected` any more. These rules let a
  // legacy row still move out of it.
  rejected: {
    lead: mustBeUnpaid,
    pending: mustBeUnpaid,
    confirmed: needsConfirmPayment,
    cancelled: OK,
  },
  cancelled: {
    lead: reinstateViaConfirm,
    pending: reinstateViaConfirm,
    confirmed: needsConfirmPayment,
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
  // Money kept on a dead booking — not neutral like a settled refund.
  no_refund: 'background:var(--color-caution-surface);color:var(--color-caution-ink);',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  advance_paid: 'Advance paid',
  fully_paid: 'Fully paid',
  partial_refund: 'Partial refund',
  full_refund: 'Refunded',
  no_refund: 'No refund',
};

export function paymentStatusLabel(s: string): string {
  return PAYMENT_STATUS_LABELS[s] ?? s;
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

/**
 * A cancelled booking that kept the traveller's money. Derivable, so it stays a
 * projection of the ledger like every other payment state rather than a flag
 * someone has to remember to set.
 */
export function isNoRefund(reg: {
  status?: unknown;
  amount_paid?: unknown;
  amount_refunded?: unknown;
}): boolean {
  const terminal = reg.status === 'cancelled' || reg.status === 'rejected';
  return terminal && (Number(reg.amount_paid) || 0) > 0 && (Number(reg.amount_refunded) || 0) <= 0;
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
