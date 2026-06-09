import { useState, useEffect, useMemo, useRef } from 'react';

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
  occupancyCatalog: Array<{ id: string; label: string; helperText: string }>;
  advanceAmount: number;
  balanceDueRule: string;
  fromPrice: number | null;
  whatsappLink: string;
  initialDepartureId?: string;
}

const C = {
  coral: '#E8725A',
  navy: '#1B2B3A',
  peach: '#E8DDD9',
  blush: '#FDF0EC',
  gray: '#6B7280',
  cta: '#D95F3B',
};

const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function dateRange(d: Departure) {
  return `${fmtDate(d.startDate)} – ${fmtDate(d.endDate)}`;
}

// Cheapest available offer for a departure (or null when none available).
function cheapestAvailable(dep: Departure): Offer | null {
  const avail = dep.offers.filter((o) => o.available);
  if (avail.length === 0) return null;
  return avail.reduce((min, o) => (o.price < min.price ? o : min), avail[0]);
}

export default function BookingPanel({
  departures,
  occupancyCatalog,
  advanceAmount,
  balanceDueRule,
  fromPrice,
  whatsappLink,
  initialDepartureId,
}: Props) {
  const allSoldOut = departures.length > 0 && departures.every((d) => d.soldOut);

  // Initial departure: ?batch= target if bookable, else first non-sold-out, else first.
  const initialDep = useMemo(() => {
    const urlBatch = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('batch')
      : null;
    const wantedId = initialDepartureId || urlBatch;
    const wanted = wantedId
      ? departures.find((d) => d.id === wantedId && !d.soldOut)
      : null;
    return wanted ?? departures.find((d) => !d.soldOut) ?? departures[0] ?? null;
  }, [departures, initialDepartureId]);

  const [departureId, setDepartureId] = useState<string>(initialDep?.id ?? '');
  const [tierId, setTierId] = useState<string>(() => {
    const t = initialDep ? cheapestAvailable(initialDep) : null;
    return t?.tierId ?? '';
  });
  const [notice, setNotice] = useState<string>('');

  const selectedDeparture = departures.find((d) => d.id === departureId) ?? null;
  const availableOffers = selectedDeparture ? selectedDeparture.offers.filter((o) => o.available) : [];
  const selectedOffer =
    selectedDeparture?.offers.find((o) => o.tierId === tierId && o.available) ??
    (selectedDeparture ? cheapestAvailable(selectedDeparture) : null);

  const perPerson = selectedOffer?.price ?? 0;
  const advanceDue = Math.min(advanceAmount, perPerson || advanceAmount);
  const balance = Math.max(0, perPerson - advanceDue);

  // ── Selecting a date: re-validate the held tier against the new date ──────
  function selectDeparture(dep: Departure) {
    if (dep.soldOut) return;
    setDepartureId(dep.id);
    const held = dep.offers.find((o) => o.tierId === tierId && o.available);
    if (held) {
      setNotice('');
    } else {
      const fallback = cheapestAvailable(dep);
      if (fallback) {
        const prev = selectedDeparture?.offers.find((o) => o.tierId === tierId);
        setTierId(fallback.tierId);
        if (prev && prev.label !== fallback.label) {
          setNotice(`${prev.label} isn't available for these dates. Switched you to ${fallback.label}.`);
        } else {
          setNotice('');
        }
      }
    }
    if (typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', 'select_batch', { batch_id: dep.id });
    }
  }

  function selectTier(offer: Offer) {
    if (!offer.available) return;
    setTierId(offer.tierId);
    setNotice('');
  }

  // ── Broadcast the current selection to the rest of the page (reg form + sticky bar) ──
  const lastSent = useRef<string>('');
  useEffect(() => {
    if (!selectedDeparture || !selectedOffer) return;
    const detail = {
      departureId: selectedDeparture.id,
      tierId: selectedOffer.tierId,
      tierLabel: selectedOffer.label,
      perPersonPrice: perPerson,
      advanceDue,
      balance,
      dateStr: dateRange(selectedDeparture),
    };
    const key = JSON.stringify(detail);
    if (key === lastSent.current) return;
    lastSent.current = key;
    window.dispatchEvent(new CustomEvent('stt:booking-changed', { detail }));
  }, [selectedDeparture, selectedOffer, perPerson, advanceDue, balance]);

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

  // Skip the chooser only when the date genuinely offers a single tier (e.g. a
  // dorm-only date, or a single-catalog trip like Kashmir). A date that offers
  // two tiers but has one sold out still shows the chooser, with the sold-out
  // tier disabled (spec point 1 vs point 2).
  const singleTier = selectedDeparture ? selectedDeparture.offers.length === 1 : false;
  // The "X only for these dates" note is only meaningful when the trip has more
  // than one tier overall; for single-catalog trips, render nothing.
  const showSingleTierNote = singleTier && occupancyCatalog.length > 1;

  return (
    <div>
      {/* Price header — the "from" floor (never contradicted; summary is the truth) */}
      {fromPrice != null && (
        <div className="mb-5">
          <span className="text-sm mr-1" style={{ color: C.gray }}>from</span>
          <span className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>
            {inr(fromPrice)}
          </span>
          <span className="text-sm ml-1" style={{ color: C.gray }}>/ person</span>
        </div>
      )}

      {/* ── Dates ─────────────────────────────────────────────────────────── */}
      {departures.length > 1 && (
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

      {/* Single departure: show its dates as a static line */}
      {departures.length === 1 && selectedDeparture && (
        <div className="mb-5 text-sm">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.gray }}>Dates</p>
          <p style={{ color: C.navy }}>{dateRange(selectedDeparture)}</p>
          {selectedDeparture.spotsLeft != null && (
            <div className="mt-3">
              <div
                className="text-xs mb-1"
                style={{
                  color: selectedDeparture.spotsLeft <= 3 ? C.coral : C.gray,
                  fontWeight: selectedDeparture.spotsLeft <= 3 ? 600 : 400,
                }}
              >
                {selectedDeparture.spotsLeft <= 3
                  ? `Only ${selectedDeparture.spotsLeft} left`
                  : `${selectedDeparture.spotsLeft} of ${selectedDeparture.totalCap} left`}
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#F5DDD7' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${
                      selectedDeparture.totalCap && selectedDeparture.totalCap > 0
                        ? Math.min(100, ((selectedDeparture.totalCap - selectedDeparture.spotsLeft) / selectedDeparture.totalCap) * 100)
                        : 0
                    }%`,
                    background: selectedDeparture.spotsLeft <= 3 ? C.coral : C.navy,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Occupancy (reactive to the selected date) ─────────────────────── */}
      {selectedDeparture && (
        singleTier ? (
          showSingleTierNote && availableOffers[0] ? (
            <div className="mb-5 text-xs" style={{ color: C.gray }}>
              {availableOffers[0].label} only for these dates.
            </div>
          ) : null
        ) : (
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
                      {inr(offer.price)}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Re-validation notice */}
      {notice && (
        <div className="mb-5 rounded-xl px-4 py-2.5 text-xs" style={{ background: C.blush, color: C.navy }}>
          {notice}
        </div>
      )}

      {/* ── Booking summary (single source of truth) ──────────────────────── */}
      {selectedOffer && (
        <div className="mb-5 rounded-xl overflow-hidden border text-sm" style={{ borderColor: C.peach }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.peach}` }}>
            <span style={{ color: C.gray }}>Per person</span>
            <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>{inr(perPerson)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3" style={{ background: C.blush, borderBottom: `1px solid ${C.peach}` }}>
            <span className="font-semibold" style={{ color: C.coral }}>Advance now</span>
            <span className="font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>{inr(advanceDue)}</span>
          </div>
          <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.peach}` }}>
            <div className="flex items-center justify-between">
              <span style={{ color: C.gray }}>Balance before trip</span>
              <span className="font-semibold" style={{ color: C.navy }}>{inr(balance)}</span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: C.gray }}>due {balanceDueRule}</div>
          </div>
          <div className="px-4 py-2 text-xs" style={{ color: C.gray }}>Advance is non-refundable.</div>
        </div>
      )}

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <a
        href="#register"
        className="block w-full text-center font-semibold text-white py-3.5 rounded-full transition-all hover:opacity-90 hover:shadow-md"
        style={{ background: C.cta }}
      >
        Save my spot →
      </a>
    </div>
  );
}
