import { useEffect, useRef, useState } from 'react';

interface Stat {
  value: number;
  label: string;
  suffix?: string;
  iconPath?: string;
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
      const ease = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(ease * target));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [shouldStart, target, duration]);

  return count;
}

function StatItem({ value, label, suffix = '+', iconPath, shouldStart }: Stat & { shouldStart: boolean }) {
  const count = useCountUp(value, 2000, shouldStart);

  return (
    <div className="text-center">
      {iconPath && (
        <div className="flex justify-center mb-3 sm:mb-4">
          <svg
            className="w-10 h-10 sm:w-12 sm:h-12"
            style={{ color: 'var(--color-coral)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={iconPath} />
          </svg>
        </div>
      )}
      <div
        className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-1 sm:mb-2"
        style={{ fontFamily: 'var(--font-display)', color: iconPath ? 'white' : 'var(--color-navy)' }}
      >
        {count.toLocaleString('en-IN')}{suffix}
      </div>
      <div
        className="text-sm sm:text-base lg:text-lg"
        style={{ color: iconPath ? 'rgba(255,255,255,0.8)' : 'var(--color-gray-text)' }}
      >
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
    <div ref={ref} className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
      {stats.map((stat) => (
        <StatItem key={stat.label} {...stat} shouldStart={started} />
      ))}
    </div>
  );
}
