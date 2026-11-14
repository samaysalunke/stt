import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import DayAccordion from './DayAccordion';

// The booking details form, loaded only when a visitor opens it.
const BookingCheckout = lazy(() => import('./BookingCheckout'));
type CheckoutProps = ComponentProps<typeof BookingCheckout>;

type Day = Parameters<typeof DayAccordion>[0]['itinerary'][number];

interface Props {
  slug: string;
  tripName: string;
  /** The days shown before the lock. The rest never reaches this page's HTML. */
  preview: Day[];
  /** Total days in the plan, preview included. */
  totalDays: number;
  unlockMode: 'book' | 'wishlist';
  unlockBatchId: string;
  /** Where to send a visitor who would rather book after reading the plan. */
  continueHref: string;
  /**
   * The registration form, shown inline in the lock (book mode). The same
   * details form as checkout, so the visitor becomes the same `lead`.
   */
  form?: Pick<CheckoutProps, 'departure' | 'offer' | 'advanceAmount' | 'balanceDueRule' | 'isLoggedIn' | 'prefill' | 'prefilledFromHistory'> | null;
}

/** Link straight to the open form, e.g. from an ad or Instagram: /trips/<slug>/#see-itinerary */
export const OPEN_FORM_HASH = '#see-itinerary';

const ACCESS_COOKIE = 'stt_itinerary_access';

/**
 * The trip page's itinerary when its full plan is locked behind registration
 * (see src/lib/itineraryGate.ts). Renders the preview days and a lock card, and
 * swaps in the full plan from /api/trip-itinerary once this browser has
 * registered — on load when it holds an access cookie, and again when a
 * wishlist sign-up on this page completes.
 */
export default function ItineraryGate({ slug, tripName, preview, totalDays, unlockMode, unlockBatchId, continueHref, form = null }: Props) {
  const [full, setFull] = useState<Day[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // The mobile sticky "Save my spot" bar would sit over the form being filled.
  useEffect(() => {
    const bar = document.getElementById('booking-sticky');
    if (!bar) return;
    bar.classList.toggle('hidden', formOpen && !full);
    return () => bar.classList.remove('hidden');
  }, [formOpen, full]);

  const openForm = useCallback(() => {
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  const tryUnlock = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/trip-itinerary?slug=${encodeURIComponent(slug)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && Array.isArray(data.itinerary)) {
        setFull(data.itinerary);
        return true;
      }
    } catch { /* stay locked */ } finally {
      setChecking(false);
    }
    return false;
  }, [slug]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromRegistration = params.get('itinerary') === 'unlocked';
    if (fromRegistration) {
      // Tidy the URL so a share or reload doesn't repeat the welcome note.
      params.delete('itinerary');
      const qs = params.toString();
      history.replaceState(history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
    const wantsForm = window.location.hash === OPEN_FORM_HASH;
    const hasCookie = document.cookie.split('; ').some((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    if (fromRegistration || hasCookie) {
      tryUnlock().then((ok) => {
        if (ok && (fromRegistration || wantsForm)) {
          setJustUnlocked(fromRegistration);
          requestAnimationFrame(() => document.getElementById('itinerary')?.scrollIntoView({ block: 'start' }));
        } else if (!ok && wantsForm && form) {
          openForm();
        }
      });
    } else if (wantsForm && form) {
      openForm();
    }
    const onAccess = () => { tryUnlock().then((ok) => ok && setJustUnlocked(true)); };
    // The hero's "See the day-by-day plan" link lands here without a reload.
    const onHash = () => {
      if (window.location.hash !== OPEN_FORM_HASH) return;
      if (form) openForm();
      else document.getElementById('itinerary')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('stt:itinerary-access', onAccess);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('stt:itinerary-access', onAccess);
      window.removeEventListener('hashchange', onHash);
    };
  }, [tryUnlock, openForm, form]);

  if (full) {
    return (
      <div data-testid="itinerary-unlocked">
        {justUnlocked && (
          <div data-testid="itinerary-unlocked-note" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--color-success-surface)', color: 'var(--color-success-surface-ink)' }}>
            <span className="font-semibold">The full plan is yours. Have a read.</span>
            {unlockMode === 'book' && (
              <a href={continueHref} className="font-semibold underline underline-offset-2">Ready? Save your spot →</a>
            )}
          </div>
        )}
        <DayAccordion itinerary={full} tripName={tripName} />
      </div>
    );
  }

  const hiddenCount = Math.max(0, totalDays - preview.length);
  const firstHidden = (preview[preview.length - 1]?.day ?? 0) + 1;
  // Placeholder rows: day numbers only. Nothing of the hidden plan is on the page.
  const ghostRows = Array.from({ length: Math.min(3, hiddenCount) }, (_, i) => firstHidden + i);

  const unlockWishlist = () => {
    window.dispatchEvent(new CustomEvent('stt:select-departure', { detail: { batchId: unlockBatchId } }));
    document.getElementById('booking-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div data-testid="itinerary-locked">
      {preview.length > 0 && <DayAccordion itinerary={preview} tripName={tripName} />}
      <div className="relative mt-2">
        <div aria-hidden="true" className="space-y-2 select-none">
          {ghostRows.map((n, i) => (
            <div key={n} className="flex items-center gap-3 rounded-xl border bg-white px-5 py-4" style={{ borderColor: 'var(--color-border)', opacity: 1 - i * 0.3 }}>
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: 'var(--color-peach)', color: 'var(--color-navy)' }}>{n}</span>
              <span className="h-3 rounded-full blur-[2px]" style={{ width: `${55 - i * 10}%`, background: 'var(--color-border)' }} />
            </div>
          ))}
        </div>
        <div id={OPEN_FORM_HASH.slice(1)} className="mt-4 scroll-mt-24 rounded-2xl border-2 border-dashed px-5 py-6 text-center" style={{ borderColor: 'var(--color-coral)', background: 'var(--color-blush)' }}>
          <svg className="mx-auto mb-2 h-6 w-6" style={{ color: 'var(--color-coral-ink)' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path strokeLinecap="round" d="M8 11V7a4 4 0 118 0v4" />
          </svg>
          <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-navy)' }}>
            {hiddenCount === 1 ? 'One more day to the plan' : `${hiddenCount} more days to the plan`}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm" style={{ color: 'var(--color-gray-text)' }}>
            {unlockMode === 'book'
              ? 'Register for this trip to see the full day-by-day itinerary. It takes a minute, and no payment is needed to see it.'
              : 'Join the wishlist for the upcoming date to see the full day-by-day itinerary.'}
          </p>
          {unlockMode === 'book' ? (
            !formOpen && <a
              href={`/trips/${slug}/book?batch=${encodeURIComponent(unlockBatchId)}&unlock=itinerary`}
              onClick={(e) => { if (form) { e.preventDefault(); openForm(); } }}
              data-testid="itinerary-unlock-cta"
              className="mt-4 inline-block rounded-[var(--radius-pill)] px-6 py-3 text-sm font-semibold text-white"
              style={{ background: 'var(--color-cta)' }}
            >
              Register to see the full plan →
            </a>
          ) : (
            <button
              type="button"
              onClick={unlockWishlist}
              data-testid="itinerary-unlock-cta"
              className="mt-4 inline-block cursor-pointer rounded-[var(--radius-pill)] px-6 py-3 text-sm font-semibold text-white"
              style={{ background: 'var(--color-cta)' }}
            >
              Join the wishlist to see it →
            </button>
          )}
          {formOpen && form && (
            <div ref={formRef} data-testid="itinerary-unlock-form" className="mx-auto mt-5 max-w-lg scroll-mt-24 text-left">
              <Suspense fallback={<p className="py-6 text-center text-sm" style={{ color: 'var(--color-gray-text)' }}>Loading the form…</p>}>
                <BookingCheckout
                  {...form}
                  slug={slug}
                  tripName={tripName}
                  upiId=""
                  bankAccountName=""
                  bankAccountNumber=""
                  bankBranch=""
                  bankIfsc=""
                  embedded
                  onRegistered={async () => {
                    if (await tryUnlock()) {
                      setJustUnlocked(true);
                      requestAnimationFrame(() => document.getElementById('itinerary')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }
                  }}
                />
              </Suspense>
            </div>
          )}
          <p className="mt-3 text-xs" style={{ color: 'var(--color-gray-text)' }}>
            {checking ? 'Checking your registration…' : (
              <>Already registered? <a href={`/api/auth/google?next=${encodeURIComponent(`/trips/${slug}/`)}`} className="font-semibold underline underline-offset-2" style={{ color: 'var(--color-coral-ink)' }}>Sign in with the email you used</a></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
