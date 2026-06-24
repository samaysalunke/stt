import { useState } from 'react';
import { formatDateIN, formatINR } from '../lib/utils';

// Mirrors the ResolvedBooking shape from src/lib/content.ts. Re-declared here
// (not imported) so this client island never pulls node `fs` into the bundle.
interface Offer {
  tierId: string;
  label: string;
  helperText: string;
  price: number;
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
}
interface Props {
  departures: Departure[];
  advanceAmount: number;
  balanceDueRule: string;
  fromPrice: number | null;
  whatsappLink: string;
  slug: string;
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
  whatsappLink,
  slug,
}: Props) {
  const allSoldOut = departures.length > 0 && departures.every((d) => d.soldOut);
  const [departureId, setDepartureId] = useState<string>('');
  const [tierId, setTierId] = useState<string>('');

  const selectedDeparture = departures.find((d) => d.id === departureId) ?? null;
  const selectedOffer = selectedDeparture?.offers.find((o) => o.tierId === tierId && o.available) ?? null;

  const perPerson = selectedOffer?.price ?? 0;
  const advanceDue = Math.min(advanceAmount, perPerson || advanceAmount);
  const balance = Math.max(0, perPerson - advanceDue);

  // A new date always requires an explicit occupancy choice.
  function selectDeparture(dep: Departure) {
    if (dep.soldOut) return;
    setDepartureId(dep.id);
    setTierId('');
    if (typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', 'select_batch', { batch_id: dep.id });
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
      {/* Price header — the "from" floor (never contradicted; summary is the truth) */}
      {fromPrice != null && (
        <div className="mb-5">
          <span className="text-sm mr-1" style={{ color: C.gray }}>from</span>
          <span className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>
            {formatINR(fromPrice)}
          </span>
          <span className="text-sm ml-1" style={{ color: C.gray }}>/ person</span>
        </div>
      )}

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
              const left = dep.spotsLeft;
              const isLow = !isSoldOut && left != null && left <= 3;
              const pct =
                dep.totalCap && dep.totalCap > 0 && left != null
                  ? Math.min(100, ((dep.totalCap - left) / dep.totalCap) * 100)
                  : 0;
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
                  {isSoldOut ? (
                    <div className="text-xs mt-1" style={{ color: C.gray }}>Sold out</div>
                  ) : left != null ? (
                    <div className="mt-3">
                      <div
                        className="text-xs mb-1"
                        style={{ color: isLow ? C.coral : C.gray, fontWeight: isLow ? 600 : 400 }}
                      >
                        {isLow ? `Only ${left} left` : `${left} of ${dep.totalCap} left`}
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#F5DDD7' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: isLow ? C.coral : C.navy }}
                        />
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Occupancy (reactive to the selected date) ─────────────────────── */}
      {selectedDeparture && (
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
                  <span className="text-sm font-semibold shrink-0" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>
                    {formatINR(offer.price)}
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
            <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>{formatINR(perPerson)}</span>
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
    </div>
  );
}
