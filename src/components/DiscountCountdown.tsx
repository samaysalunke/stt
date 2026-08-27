import { useEffect, useState } from 'react';

function remainingLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function validTillLabel(endsAt: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Kolkata', timeZoneName: 'short',
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
  const countdown = remainingLabel(remaining);
  return (
    <span className={className} aria-label={`Discount valid till ${validTillLabel(endsAt)}; ${countdown} remaining`}>
      Valid till {validTillLabel(endsAt)} · {countdown}
    </span>
  );
}
