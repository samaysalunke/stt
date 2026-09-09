import { useEffect, useState } from 'react';

export function validTillLabel(endsAt: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  }).format(new Date(endsAt));
}

export function useDiscountActive(endsAt: string | null | undefined, initiallyActive = true): boolean {
  // The first client render must exactly match the server render. In particular,
  // do not consult the browser clock here: a discount can expire after the HTML
  // was rendered (or while that HTML is in the edge cache) but before hydration.
  const [active, setActive] = useState(() => Boolean(initiallyActive));

  useEffect(() => {
    if (!initiallyActive) { setActive(false); return; }
    if (!endsAt) { setActive(true); return; }
    const tick = () => setActive(new Date(endsAt).getTime() > Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt, initiallyActive]);

  return active;
}

export default function DiscountCountdown({
  endsAt,
  className = '',
  reloadOnExpire = false,
}: {
  endsAt: string;
  className?: string;
  reloadOnExpire?: boolean;
}) {
  // Callers only render this component when the server snapshot says the
  // discount is active. Start from that same snapshot and reconcile with the
  // live clock after hydration so React never sees different initial markup.
  const [active, setActive] = useState(true);

  useEffect(() => {
    const expiresAt = new Date(endsAt).getTime();
    let refreshRequested = false;
    let observedActive = false;

    const claimRefresh = () => {
      const key = `stt_discount_refreshed:${endsAt}`;
      try {
        if (window.sessionStorage.getItem(key) === '1') return false;
        window.sessionStorage.setItem(key, '1');
      } catch {
        // Storage can be unavailable in privacy-restricted browsers. The
        // observedActive guard below still prevents a stale-load reload loop.
      }
      return true;
    };

    const tick = () => {
      const nextActive = Number.isFinite(expiresAt) && expiresAt > Date.now();
      setActive(nextActive);
      if (nextActive) {
        observedActive = true;
      } else if (reloadOnExpire && observedActive && !refreshRequested && claimRefresh()) {
        refreshRequested = true;
        window.location.reload();
      }
      return nextActive;
    };

    // If cached HTML is already expired when hydration finishes, hide the label
    // without reloading. Reload only when this tab actually observes the active
    // discount cross its deadline.
    if (!tick()) return;
    const timer = window.setInterval(() => {
      if (!tick()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt, reloadOnExpire]);

  if (!active) return null;
  return (
    <span data-testid="discount-expiry" className={className}>
      Valid till {validTillLabel(endsAt)}
    </span>
  );
}
