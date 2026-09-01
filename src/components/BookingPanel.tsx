import { useState, type FormEvent } from 'react';
import { formatDateIN, formatINR } from '../lib/utils';
import DiscountCountdown, { useDiscountActive } from './DiscountCountdown';

// Mirrors the ResolvedBooking shape from src/lib/content.ts. Re-declared here
// (not imported) so this client island never pulls node `fs` into the bundle.
interface Offer {
  tierId: string;
  label: string;
  helperText: string;
  price: number;
  originalPrice: number | null;
  cap: number | null;
  booked: number;
  available: boolean;
}
interface Departure {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  offers: Offer[];
  totalCap: number | null;
  spotsLeft: number | null;
  soldOut: boolean;
  /** Published but not open for booking — price concealed, wishlist instead. */
  comingSoon?: boolean;
  /** Admin-controlled urgency label; the departure remains normally bookable. */
  fillingFast?: boolean;
  priceConcealed?: boolean;
  discountAmount?: number;
  discountEndsAt?: string | null;
  discountActive?: boolean;
}
interface Props {
  departures: Departure[];
  advanceAmount: number;
  balanceDueRule: string;
  fromPrice: number | null;
  originalFromPrice?: number | null;
  fromDiscountEndsAt?: string | null;
  whatsappLink: string;
  slug: string;
  /** Present when a signed-in traveller is viewing — prefills the wishlist form. */
  wishlistUser?: { name: string; email: string; phone: string } | null;
}

const C = {
  coral: '#E8725A',
  navy: '#1B2B3A',
  peach: '#E8DDD9',
  blush: '#FDF0EC',
  gray: '#6B7280',
  cta: '#D95F3B',
};

function dateRange(d: Departure) {
  return `${formatDateIN(d.startDate)} – ${formatDateIN(d.endDate)}`;
}

export default function BookingPanel({
  departures,
  advanceAmount,
  balanceDueRule,
  fromPrice,
  originalFromPrice = null,
  fromDiscountEndsAt = null,
  whatsappLink,
  slug,
  wishlistUser = null,
}: Props) {
  const bookable = departures.filter((d) => !d.comingSoon);
  const anyComingSoon = departures.some((d) => d.comingSoon);
  // Only short-circuit to the waitlist block when there is genuinely nothing to
  // do — every bookable date is full AND there's no coming-soon date to wishlist.
  const allSoldOut = bookable.length > 0 && bookable.every((d) => d.soldOut) && !anyComingSoon;
  // Booking flow normally starts with nothing selected (explicit choice).
  // Exceptions, both pre-selecting departures[0]:
  //  - an all-coming-soon trip, so the wishlist form is immediately visible;
  //  - a trip with exactly one departure, so only occupancy is left to choose.
  const initialDeparture =
    departures.length === 1 || bookable.length === 0 ? (departures[0]?.id ?? '') : '';
  const [departureId, setDepartureId] = useState<string>(initialDeparture);
  const [tierId, setTierId] = useState<string>('');

  const selectedDeparture = departures.find((d) => d.id === departureId) ?? null;
  const selectedComingSoon = !!selectedDeparture?.comingSoon;
  const selectedOffer = selectedDeparture?.offers.find((o) => o.tierId === tierId && o.available) ?? null;
  const selectedDiscountActive = useDiscountActive(selectedDeparture?.discountEndsAt, !!selectedDeparture?.discountActive);

  const perPerson = selectedOffer
    ? (selectedDiscountActive ? selectedOffer.price : (selectedOffer.originalPrice ?? selectedOffer.price))
    : 0;
  const advanceDue = Math.min(advanceAmount, perPerson);
  const balance = Math.max(0, perPerson - advanceDue);

  // ── Wishlist (coming-soon dates) ──────────────────────────────────────────
  const [wlName, setWlName] = useState(wishlistUser?.name ?? '');
  const [wlEmail, setWlEmail] = useState(wishlistUser?.email ?? '');
  const [wlPhone, setWlPhone] = useState(wishlistUser?.phone ?? '');
  const [wlState, setWlState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [wlError, setWlError] = useState('');

  async function submitWishlist(e: FormEvent) {
    e.preventDefault();
    if (!selectedDeparture) return;
    setWlState('submitting');
    setWlError('');
    try {
      const res = await fetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripSlug: slug,
          batchId: selectedDeparture.id,
          name: wlName,
          email: wlEmail,
          phone: wlPhone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setWlState('done');
        if (typeof (window as any).gtag === 'function') {
          (window as any).gtag('event', 'wishlist_join', { batch_id: selectedDeparture.id });
        }
      } else {
        setWlState('error');
        setWlError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setWlState('error');
      setWlError('Network error. Please try again.');
    }
  }

  // A new date always requires an explicit occupancy choice.
  function selectDeparture(dep: Departure) {
    if (dep.soldOut) return;
    setDepartureId(dep.id);
    setTierId('');
    if (dep.comingSoon) {
      setWlState('idle');
      setWlError('');
    }
    if (typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', dep.comingSoon ? 'wishlist_view' : 'select_batch', { batch_id: dep.id });
    }
  }

  function selectTier(offer: Offer) {
    if (!offer.available) return;
    setTierId(offer.tierId);
  }

  // ── All departures sold out ───────────────────────────────────────────────
  if (allSoldOut) {
    return (
      <div className="rounded-2xl border p-5 text-center" style={{ borderColor: C.peach }}>
        <p className="text-sm font-medium mb-3" style={{ color: C.navy }}>Fully booked.</p>
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener"
          className="inline-block w-full text-center font-semibold text-white py-3 rounded-full"
          style={{ background: C.cta }}
        >
          Join the waitlist
        </a>
      </div>
    );
  }

  return (
    <div>
      {/* Price header — status for coming-soon dates, otherwise the "from" floor */}
      {selectedComingSoon ? (
        <div className="mb-5">
          <span
            className="text-3xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: C.coral }}
          >
            Coming soon
          </span>
        </div>
      ) : fromPrice != null ? (
        <div className="mb-5">
          {originalFromPrice != null && (
            <span className="text-sm mr-2 line-through" style={{ color: C.gray }}>{formatINR(originalFromPrice)}</span>
          )}
          <span className="text-sm mr-1" style={{ color: C.gray }}>from</span>
          <span className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>
            {formatINR(fromPrice)}
          </span>
          <span className="text-sm ml-1" style={{ color: C.gray }}>/ person</span>
          {originalFromPrice != null && fromDiscountEndsAt && (
            <DiscountCountdown endsAt={fromDiscountEndsAt} reloadOnExpire className="block mt-1 text-xs font-semibold" />
          )}
        </div>
      ) : null}

      {/* ── Dates ─────────────────────────────────────────────────────────── */}
      {departures.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.gray }}>
            Choose your dates
          </p>
          <div className="space-y-3">
            {departures.map((dep) => {
              const isSelected = dep.id === departureId;
              const isSoldOut = dep.soldOut;
              return (
                <button
                  key={dep.id}
                  data-testid={`departure-${dep.id}`}
                  onClick={() => selectDeparture(dep)}
                  disabled={isSoldOut}
                  className="w-full text-left rounded-xl border-2 p-4 transition-all duration-150"
                  style={{
                    borderColor: isSelected ? C.coral : C.peach,
                    background: isSelected ? C.blush : 'white',
                    opacity: isSoldOut ? 0.5 : 1,
                    cursor: isSoldOut ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div className="font-semibold text-sm" style={{ color: C.navy, fontFamily: 'var(--font-display)' }}>
                    {dateRange(dep)}
                  </div>
                  {dep.discountActive && !dep.comingSoon && (
                    <div className="text-xs mt-1 font-semibold" style={{ color: C.coral }}>
                      Save {formatINR(dep.discountAmount ?? 0)} on every stay
                      {dep.discountEndsAt && <DiscountCountdown endsAt={dep.discountEndsAt} reloadOnExpire className="block mt-0.5" />}
                    </div>
                  )}
                  {dep.comingSoon ? (
                    <div className="text-xs mt-1 font-semibold" style={{ color: C.coral }}>Coming soon · wishlist to hear first</div>
                  ) : isSoldOut ? (
                    <div className="text-xs mt-1" style={{ color: C.gray }}>Sold out</div>
                  ) : dep.fillingFast ? (
                    <div className="mt-2">
                      <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: '#9A3412', background: '#FFF1E8' }}>
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: C.coral }} />
                        Filling fast
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Occupancy (reactive to the selected date; hidden for coming-soon) ─ */}
      {selectedDeparture && !selectedComingSoon && (
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: C.gray }}>
            Choose occupancy
          </p>
          <div className="flex flex-col gap-2">
            {selectedDeparture.offers.map((offer) => {
              const isSelected = selectedOffer?.tierId === offer.tierId;
              const disabled = !offer.available;
              return (
                <label
                  key={offer.tierId}
                  data-testid={`tier-${offer.tierId}`}
                  className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3"
                  style={{
                    borderColor: isSelected ? C.coral : C.peach,
                    background: isSelected ? C.blush : 'white',
                    opacity: disabled ? 0.55 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="__occupancy"
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => selectTier(offer)}
                      className="mt-0.5"
                      style={{ accentColor: C.coral }}
                    />
                    <span>
                      <span className="block text-sm font-medium" style={{ color: C.navy }}>{offer.label}</span>
                      {disabled ? (
                        <span className="block text-xs mt-0.5" style={{ color: C.coral }}>Sold out for these dates</span>
                      ) : offer.helperText ? (
                        <span className="block text-xs mt-0.5" style={{ color: C.gray }}>{offer.helperText}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-right text-sm font-semibold shrink-0" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>
                    {offer.originalPrice != null && <span className="block text-xs line-through font-normal" style={{ color: C.gray }}>{formatINR(offer.originalPrice)}</span>}
                    {formatINR(selectedDiscountActive ? offer.price : (offer.originalPrice ?? offer.price))}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Booking summary (single source of truth) ──────────────────────── */}
      {selectedOffer && (
        <div className="mb-5 rounded-xl overflow-hidden border text-sm" style={{ borderColor: C.peach }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.peach}` }}>
            <span style={{ color: C.gray }}>Per person</span>
            <span className="font-semibold text-right" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>
              {selectedDiscountActive && selectedOffer.originalPrice != null && <span className="mr-2 text-xs line-through font-normal" style={{ color: C.gray }}>{formatINR(selectedOffer.originalPrice)}</span>}
              {formatINR(perPerson)}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: C.blush, borderBottom: `1px solid ${C.peach}` }}>
            <span className="font-semibold" style={{ color: C.coral }}>Advance now</span>
            <span className="font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>{formatINR(advanceDue)}</span>
          </div>
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.peach}` }}>
            <div className="flex items-center justify-between">
              <span style={{ color: C.gray }}>Balance before trip</span>
              <span className="font-semibold" style={{ color: C.navy }}>{formatINR(balance)}</span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: C.gray }}>due {balanceDueRule}</div>
          </div>
          <div className="px-4 py-2 text-xs" style={{ color: C.gray }}>Advance is non-refundable.</div>
        </div>
      )}

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      {selectedComingSoon ? (
        wlState === 'done' ? (
          <div
            data-testid="wishlist-confirmation"
            className="rounded-xl border p-4 text-center text-sm"
            style={{ borderColor: C.peach, background: C.blush, color: C.navy }}
          >
            <p className="font-semibold mb-1">You're on the list.</p>
            <p style={{ color: C.gray }}>We'll email you the moment {dateRange(selectedDeparture!)} opens for booking.</p>
          </div>
        ) : (
          <form id="wishlist-form" onSubmit={submitWishlist} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.gray }}>
              Join the wishlist
            </p>
            <input
              type="text" required placeholder="Your name" value={wlName}
              onChange={(e) => setWlName(e.target.value)}
              readOnly={!!wishlistUser?.name}
              className="w-full rounded-xl border px-4 py-2.5 text-sm"
              style={{ borderColor: C.peach, background: wishlistUser?.name ? C.blush : 'white' }}
            />
            <input
              type="email" required placeholder="Email" value={wlEmail}
              onChange={(e) => setWlEmail(e.target.value)}
              readOnly={!!wishlistUser?.email}
              className="w-full rounded-xl border px-4 py-2.5 text-sm"
              style={{ borderColor: C.peach, background: wishlistUser?.email ? C.blush : 'white' }}
            />
            <input
              type="tel" required placeholder="Phone" value={wlPhone}
              onChange={(e) => setWlPhone(e.target.value)}
              className="w-full rounded-xl border px-4 py-2.5 text-sm"
              style={{ borderColor: C.peach }}
            />
            {wlState === 'error' && (
              <p className="text-xs" style={{ color: C.coral }}>{wlError}</p>
            )}
            <button
              id="booking-panel-cta"
              type="submit"
              disabled={wlState === 'submitting'}
              className="block w-full text-center font-semibold text-white py-3.5 rounded-full transition-all"
              style={{ background: C.cta, opacity: wlState === 'submitting' ? 0.6 : 1 }}
            >
              {wlState === 'submitting' ? 'Adding you…' : 'Wishlist now →'}
            </button>
            <p className="text-xs text-center" style={{ color: C.gray }}>
              No spam — one email when this date opens.
            </p>
          </form>
        )
      ) : (
        <a
          id="booking-panel-cta"
          href={selectedDeparture && selectedOffer ? `/trips/${slug}/book?batch=${departureId}&tier=${tierId}` : undefined}
          aria-disabled={!selectedDeparture || !selectedOffer}
          tabIndex={selectedDeparture && selectedOffer ? 0 : -1}
          onClick={(event) => {
            if (!selectedDeparture || !selectedOffer) event.preventDefault();
          }}
          className="block w-full text-center font-semibold text-white py-3.5 rounded-full transition-all"
          style={{
            background: C.cta,
            opacity: selectedDeparture && selectedOffer ? 1 : 0.5,
            cursor: selectedDeparture && selectedOffer ? 'pointer' : 'not-allowed',
          }}
          title={selectedDeparture && selectedOffer ? undefined : 'Choose your dates and occupancy first'}
        >
          Save my spot →
        </a>
      )}
    </div>
  );
}
