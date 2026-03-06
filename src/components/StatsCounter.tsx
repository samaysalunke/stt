import { useEffect, useRef, useState } from 'react';

interface Stat {
  value: number;
  label: string;
  suffix?: string;
}

interface Props {
  stats: Stat[];
}

function useCountUp(target: number, duration: number = 2000, shouldStart: boolean = false) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!shouldStart) return;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(ease * target));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [shouldStart, target, duration]);

  return count;
}

function StatItem({ value, label, suffix = '+', shouldStart }: Stat & { shouldStart: boolean }) {
  const count = useCountUp(value, 2000, shouldStart);

  return (
    <div className="text-center px-4">
      <div className="text-5xl lg:text-6xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
        {count.toLocaleString('en-IN')}{suffix}
      </div>
      <div className="text-sm lg:text-base font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        {label}
      </div>
    </div>
  );
}

export default function StatsCounter({ stats }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
      {stats.map((stat) => (
        <StatItem key={stat.label} {...stat} shouldStart={started} />
      ))}
    </div>
  );
}
