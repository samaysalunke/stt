import { useEffect, useState } from 'react';

export function validTillLabel(endsAt: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  }).format(new Date(endsAt));
}

export function useDiscountActive(endsAt: string | null | undefined, initiallyActive = true): boolean {
  const [active, setActive] = useState(() => {
    if (!initiallyActive) return false;
    if (!endsAt) return true;
    return new Date(endsAt).getTime() > Date.now();
  });

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
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(endsAt).getTime() - Date.now()));

  useEffect(() => {
    let expired = false;
    const tick = () => {
      const next = Math.max(0, new Date(endsAt).getTime() - Date.now());
      setRemaining(next);
      if (next === 0 && reloadOnExpire && !expired) {
        expired = true;
        window.location.reload();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt, reloadOnExpire]);

  if (remaining <= 0) return null;
  return (
    <span data-testid="discount-expiry" className={className}>
      Valid till {validTillLabel(endsAt)}
    </span>
  );
}
