/**
 * The booking status transition, as a function.
 *
 * Lifted verbatim out of `POST /api/admin/update-registration`, which had grown
 * into ~320 lines of transition matrix, capacity pre-flight, amount resolution,
 * ledger writes, Zoho, email, leaderboard, audit and cache purge — all of it
 * reachable only by constructing an HTTP request with an admin session cookie.
 *
 * The actor is a parameter rather than `locals.adminUser` so a non-HTTP caller
 * (the Telegram webhook in docs/telegram-two-way-actions-plan.md) can run the
 * same path with the same guards instead of reimplementing a second copy of it.
 *
 * Failures come back as values, not exceptions: `{ ok: false, status, error }`
 * carries the HTTP status and the client-safe message the endpoint used to
 * return directly. An unexpected throw still propagates, and the route turns it
 * into the 500 it always did.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { findTripByName, readTrip } from './content';
import {
  sendRegistrationPaymentConfirmed,
  sendRegistrationStatusRejected,
  sendRegistrationCancelled,
} from './email';
import { logAction } from './audit';
import { recalculateUserLeaderboard } from './stats';
import { tripAdvanceAmountBySlug, adjustBookingCount } from './registrationWrite';
import { purgeUrls, tripPaths, TRIP_LISTING_PATHS } from './cachePurge';
import {
  ensureFinalDocumentIfFullyPaid,
  recordPayment,
  recordRefund,
  sanitizePaymentMethod,
  validReceivedAt,
} from './paymentLedger';
import { processZohoDocument } from './zohoBooks';
import { assertTransition, ADMIN_SETTABLE_STATUSES } from './registrationStatus';
import { dispatchTelegramEvent, enqueueTelegramEvent, type TelegramEventType } from './telegram';

/** Who is making the change. Shapes the ledger, the audit row, and nothing else. */
export interface ActorRef {
  userId?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface StatusChangeInput {
  id: unknown;
  status: unknown;
  adminNotes?: unknown;
  requestId?: unknown;
  /** Required on → confirmed: 'advance_paid' | 'fully_paid'. */
  paymentStatus?: unknown;
  /** Advance override on → confirmed. */
  amount?: unknown;
  receivedAt?: unknown;
  method?: unknown;
  transactionReference?: unknown;
  /** Bundled refund on → cancelled: { kind, amount, receivedAt?, method?, transactionReference? }. */
  refund?: unknown;
}

export type StatusChangeResult =
  | { ok: true; noop?: boolean }
  | { ok: false; status: number; error: string };

const fail = (error: string, status = 400): StatusChangeResult => ({ ok: false, status, error });

export async function applyStatusChange(
  input: StatusChangeInput,
  actor: ActorRef = {},
): Promise<StatusChangeResult> {
  const id = parseInt(String(input.id));
  const newStatus = (input.status as any)?.toString();
  const adminNotes = (input.adminNotes as any)?.toString() ?? '';
  const requestId = String(input.requestId || randomUUID());
  const requestedPaymentStatus = input.paymentStatus ? String(input.paymentStatus) : undefined;

  if (!id || !(ADMIN_SETTABLE_STATUSES as readonly string[]).includes(newStatus)) {
    return fail('Invalid input.');
  }

  const reg = getDb().prepare('SELECT * FROM registrations WHERE id = ?').get(id) as Record<string, any> | null;
  if (!reg) return fail('Registration not found.', 404);

  const prevStatus = (reg.status as string) ?? 'pending';
  const tripName = reg.trip_name as string;
  const batchId = (reg.batch_id as string) ?? null;
  const tierId = (reg.tier_id as string) ?? null;
  const currentPaid = Number(reg.amount_paid) || 0;
  const currentRefunded = Number(reg.amount_refunded) || 0;
  // Set wherever this request moves a seat counter. Confirming the booking
  // that fills a trip changes the sold-out badge and the CTA on the listings,
  // so the edge copies of those pages have to go — otherwise they show
  // "N spots left" and a live CTA for up to the full TTL.
  let seatsChanged = false;
  const totalRaw = Number(reg.total_amount);
  const totalAmount = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;

  // ── Transition matrix (single source of truth) ─────────────────────────
  if (newStatus === prevStatus) return { ok: true, noop: true };
  try {
    assertTransition(prevStatus, newStatus, { amountPaid: currentPaid, totalAmount, requestedPaymentStatus });
  } catch (e: any) {
    return fail(String(e?.message || 'This status change is not allowed.'));
  }

  const configuredAdvance = tripAdvanceAmountBySlug(String(reg.trip_slug || ''));

  // ── Pre-flight: capacity (must run before the UPDATE) ──────────────────
  if (newStatus === 'confirmed' && prevStatus !== 'confirmed' && batchId && tierId) {
    const confirmedCount = (getDb()
      .prepare('SELECT COUNT(*) as n FROM registrations WHERE batch_id=? AND tier_id=? AND status=?')
      .get(batchId, tierId, 'confirmed') as { n: number }).n;
    try {
      const matched = findTripByName(tripName);
      if (matched) {
        const tripData = readTrip(matched.slug);
        const batch = (tripData?.batches as any[])?.find((b: any) => b.id === batchId);
        const offer = (batch?.offers as any[])?.find((o: any) => o.tierId === tierId);
        if (offer?.cap != null && confirmedCount >= offer.cap) {
          return fail(`This tier is now full (${confirmedCount}/${offer.cap} confirmed). Please confirm another departure or reject this booking.`);
        }
      }
    } catch { /* non-fatal */ }
  }

  // ── Pre-flight: confirm amount resolution (before any DB write) ────────
  let resolvedAmount = 0;
  // Only a fully-paid confirmation issues a Zoho document (the final invoice).
  // Advance confirmations record the payment and send the branded email, but
  // no retainer invoice — that needs a paid Zoho plan.
  let confirmDocType: 'final' | undefined;
  const hasOverride = input.amount !== undefined && input.amount !== null && input.amount !== '';
  if (newStatus === 'confirmed') {
    // assertTransition guaranteed requestedPaymentStatus ∈ {advance_paid,fully_paid} and totalAmount > 0.
    const total = totalAmount as number;
    const remainingToTotal = Math.max(0, total - currentPaid);

    if (requestedPaymentStatus === 'advance_paid' && configuredAdvance <= 0 && currentPaid === 0 && !hasOverride) {
      return fail('This trip has no advance amount configured — set paymentAmount, or record a custom amount.');
    }

    const override = hasOverride ? Number(input.amount) : null;

    if (requestedPaymentStatus === 'fully_paid') {
      confirmDocType = 'final';
      resolvedAmount = remainingToTotal;
      if (hasOverride && override !== remainingToTotal) {
        return fail(`For a full payment the amount must be the ₹${remainingToTotal.toLocaleString('en-IN')} remaining balance.`);
      }
    } else {
      if (hasOverride) {
        if (!Number.isInteger(override as number) || (override as number) < 1 || (override as number) > remainingToTotal) {
          return fail(`Advance amount must be between ₹1 and the ₹${remainingToTotal.toLocaleString('en-IN')} balance.`);
        }
        resolvedAmount = override as number;
      } else {
        resolvedAmount = Math.max(0, Math.min(configuredAdvance, total) - currentPaid);
      }
    }
  }

  // ── Pre-flight: bundled refund on → cancelled (before any DB write) ────
  const refundBody: any =
    newStatus === 'cancelled' && input.refund && typeof input.refund === 'object' ? input.refund : null;
  if (refundBody) {
    const kind = String(refundBody.kind || '');
    const amt = Number(refundBody.amount);
    if (kind !== 'partial' && kind !== 'full') return fail('Refund kind must be "partial" or "full".');
    if (!Number.isInteger(amt) || amt < 1) return fail('Refund amount must be a positive whole rupee value.');
    if (kind === 'full' && amt !== currentPaid) {
      return fail(`A full refund must equal the ₹${currentPaid.toLocaleString('en-IN')} paid.`);
    }
    if (kind === 'partial' && amt > currentPaid - 1) {
      return fail('A partial refund must be less than the amount paid.');
    }
  }

  // ── Status write ─────────────────────────────────────────────────────
  const telegramEvent = (newStatus === 'lead' || newStatus === 'pending' || newStatus === 'confirmed')
    ? newStatus as TelegramEventType : null;
  // Compare-and-swap on the status this request validated against. `reg` was
  // read outside any transaction, so two concurrent requests can both clear
  // assertTransition on the same snapshot and then both run the confirm side
  // effects below — double-counting the seat via adjustBookingCount(+1) and
  // writing two payment events, which carry different requestIds and so do
  // not collapse on the idempotency key. Losing the swap means someone else
  // moved the row first; abort before any ledger write. Same claim pattern as
  // claimOne() in lib/telegram.ts.
  //
  // COALESCE mirrors how prevStatus was derived — `status` is nullable
  // (`status TEXT DEFAULT 'pending'`), and `status = 'pending'` never matches NULL.
  const write = getDb().transaction(() => {
    const swapped = getDb()
      .prepare("UPDATE registrations SET status=?, admin_notes=?, status_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND COALESCE(status,'pending')=?")
      .run(newStatus, adminNotes, id, prevStatus).changes;
    if (!swapped) return { swapped: false, telegramQueued: false };
    return { swapped: true, telegramQueued: telegramEvent ? enqueueTelegramEvent(getDb(), id, telegramEvent) : false };
  })();
  if (!write.swapped) {
    return fail('Someone else changed this booking just now. Reload and try again.', 409);
  }
  const telegramQueued = write.telegramQueued;

  let effectivePaymentStatus = reg.payment_status as string;
  let confirmQueuedDoc = false;
  let refundResult: { amountRefunded: number; paymentStatus: string } | null = null;

  if (newStatus === 'confirmed') {
    // Reset any prior refund history on re-instatement (audit keeps the pre-reset value).
    if (prevStatus === 'cancelled') {
      getDb().prepare('UPDATE registrations SET amount_refunded=0 WHERE id=?').run(id);
    }

    if (resolvedAmount === 0) {
      // Legit no-op on the money: prior payments already cover the target, so
      // there is no ledger event to write — just converge the column.
      getDb().prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(requestedPaymentStatus, id);
      effectivePaymentStatus = requestedPaymentStatus as string;
      // The invoice is not a no-op, though. This branch confirms a booking as
      // fully paid, and used to skip the document along with the ledger event
      // — leaving a fully-paid booking with no invoice and nothing queued to
      // notice. Never throws; a document that can't be raised is the retry
      // worker's problem, not this request's.
      if (requestedPaymentStatus === 'fully_paid') ensureFinalDocumentIfFullyPaid(id);
    } else {
      const receivedAt = input.receivedAt && validReceivedAt(String(input.receivedAt))
        ? String(input.receivedAt) : new Date().toISOString();
      const method = sanitizePaymentMethod(input.method) || reg.payment_method || 'bank_transfer';
      const eventType = currentPaid > 0 ? 'balance' : 'payment';
      let recorded;
      try {
        recorded = recordPayment({
          registrationId: id,
          amount: resolvedAmount,
          receivedAt,
          method,
          transactionReference: (input.transactionReference as any) ?? reg.transaction_id,
          eventType,
          idempotencyKey: `registration-confirm:${requestId}:${id}`,
          actorUserId: actor.userId,
          actorEmail: actor.email,
          source: 'status-confirmation',
          documentType: confirmDocType,
          setPaymentStatus: requestedPaymentStatus as any,
        });
      } catch (e: any) {
        return fail(String(e?.message || 'Could not record the payment.'));
      }
      effectivePaymentStatus = requestedPaymentStatus as string;

      if (recorded.document?.status === 'queued') {
        try {
          // Await during the request: the worker sends the branded email + PDF.
          await processZohoDocument(recorded.document.id);
          confirmQueuedDoc = true;
        } catch (err) {
          // Safety net — closes the "silent until the 3rd Zoho failure" gap.
          console.error('[Zoho document]', err);
          confirmQueuedDoc = false;
        }
      }
    }

    if (prevStatus !== 'confirmed') {
      adjustBookingCount(tripName, batchId, 1, tierId);
      seatsChanged = true;
    }
  } else if (newStatus === 'cancelled') {
    if (prevStatus === 'confirmed') {
      adjustBookingCount(tripName, batchId, -1, tierId);
      seatsChanged = true;
    }
    if (refundBody) {
      const r = recordRefund({
        registrationId: id,
        amount: Number(refundBody.amount),
        refundKind: refundBody.kind,
        receivedAt: refundBody.receivedAt,
        method: sanitizePaymentMethod(refundBody.method),
        transactionReference: refundBody.transactionReference,
        requestId,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      });
      refundResult = { amountRefunded: r.amountRefunded, paymentStatus: r.paymentStatus };
      effectivePaymentStatus = r.paymentStatus;
    } else if (currentPaid > 0) {
      // Cancelled while keeping the money. "No refund" used to reach only the
      // traveller's email, leaving the row reading `advance_paid` as though a
      // balance were still owed.
      getDb().prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run('no_refund', id);
      effectivePaymentStatus = 'no_refund';
    }
  } else {
    // lead ↔ pending, cancelled → lead/pending, and the legacy rejected → *.
    // assertTransition guaranteed amount_paid === 0 here.
    getDb().prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('unpaid', id);
    effectivePaymentStatus = 'unpaid';
  }

  // ── Email notifications ──────────────────────────────────────────────
  if (newStatus === 'confirmed') {
    if (!confirmQueuedDoc) {
      const freshPaid = Number((getDb().prepare('SELECT amount_paid FROM registrations WHERE id=?').get(id) as any)?.amount_paid) || 0;
      const total = Number(reg.total_amount) || 0;
      sendRegistrationPaymentConfirmed({
        full_name: reg.full_name,
        email: reg.email,
        trip_name: tripName,
        trip_date: reg.trip_date ?? '',
        kind: effectivePaymentStatus === 'fully_paid' ? 'full' : 'advance',
        amountPaid: freshPaid,
        totalAmount: total,
        balanceDue: Math.max(0, total - freshPaid),
      }).catch((err) => console.error('[Email confirmed]', err));
    }
  } else if (newStatus === 'cancelled') {
    // `rejected` is retired as a *status*, but the two situations still read
    // very differently to the traveller. Declining someone who never had a
    // confirmed booking and paid nothing is not a cancellation: telling them
    // "this confirms your booking has been cancelled — no refund is due per
    // the cancellation policy" blames them for our decision and cites a policy
    // that does not apply. The old rejection guard was `amountPaid === 0`, so
    // this reproduces exactly who used to receive which mail.
    const wasRealBooking = currentPaid > 0 || prevStatus === 'confirmed';
    if (wasRealBooking) {
      sendRegistrationCancelled({
        full_name: reg.full_name,
        email: reg.email,
        trip_name: tripName,
        trip_date: reg.trip_date ?? '',
        refundKind: refundBody?.kind ?? 'none',
        refundAmount: Number(refundBody?.amount) || 0,
      }).catch((err) => console.error('[Email cancelled]', err));
    } else {
      sendRegistrationStatusRejected({
        full_name: reg.full_name,
        email: reg.email,
        trip_name: tripName,
      }).catch((err) => console.error('[Email declined]', err));
    }
  }

  // Leaderboard recalc when a booking is confirmed or un-confirmed (non-blocking)
  if (newStatus === 'confirmed' || prevStatus === 'confirmed') {
    recalculateUserLeaderboard(reg.email as string).catch((err) => console.error('[leaderboard recalc]', err));
  }

  // Audit (non-blocking)
  const finalRow = getDb()
    .prepare('SELECT amount_paid, amount_refunded, payment_status FROM registrations WHERE id=?')
    .get(id) as any;
  logAction({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: `booking.${newStatus}`,
    targetType: 'registration',
    targetId: String(id),
    previousValue: {
      status: prevStatus,
      payment_status: reg.payment_status,
      amount_paid: currentPaid,
      amount_refunded: currentRefunded,
    },
    newValue: {
      status: newStatus,
      admin_notes: adminNotes || undefined,
      payment: {
        payment_status: finalRow?.payment_status ?? effectivePaymentStatus,
        amount_paid: Number(finalRow?.amount_paid) || 0,
        amount_refunded: Number(finalRow?.amount_refunded) || 0,
      },
      refund: refundResult ? { kind: refundBody?.kind, amount: Number(refundBody?.amount) || 0 } : undefined,
    },
  });

  if (telegramQueued && telegramEvent) {
    await dispatchTelegramEvent(id, telegramEvent).catch((err) => console.error('[Telegram status]', err));
  }

  // Purge once, after the writes, rather than beside each adjustBookingCount:
  // both branches are mutually exclusive but this keeps it to a single API
  // call and off the synchronous read-modify-write, whose atomicity invariant
  // forbids an await anywhere near it.
  if (seatsChanged) {
    const matchedTrip = findTripByName(tripName);
    await purgeUrls(matchedTrip ? tripPaths(matchedTrip.slug) : TRIP_LISTING_PATHS);
  }

  return { ok: true };
}
