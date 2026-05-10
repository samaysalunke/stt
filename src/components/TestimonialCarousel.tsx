import { useState, useEffect } from 'react';

interface Testimonial {
  slug: string;
  name: string;
  location: string;
  rating: number;
  tripName: string;
  quote: string;
  photo?: string | null;
}

interface Props {
  testimonials: Testimonial[];
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 mb-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className="w-4 h-4" fill={i < rating ? '#D4A854' : '#e5e7eb'} viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

function TestimonialCard({ t, highlighted }: { t: Testimonial; highlighted: boolean }) {
  return (
    <div
      className={`bg-white rounded-xl p-5 sm:p-6 transition-all duration-300 flex-none ${
        highlighted ? 'scale-105 shadow-xl' : 'opacity-75 hover:opacity-90 shadow-md'
      }`}
    >
      <StarRating rating={t.rating} />
      <p className="italic leading-relaxed mb-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        "{t.quote}"
      </p>
      <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        {t.photo ? (
          <img src={t.photo} alt={t.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 text-sm"
            style={{ background: 'var(--color-primary)' }}
          >
            {t.name.charAt(0)}
          </div>
        )}
        <div>
          <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-display)', color: '#1A1A1A' }}>
            {t.name}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {t.location}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-accent)' }}>
            {t.tripName}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function TestimonialCarousel({ testimonials }: Props) {
  const [current, setCurrent] = useState(0);
  const total = testimonials.length;

  useEffect(() => {
    const timer = setInterval(() => setCurrent((c) => (c + 1) % total), 5000);
    return () => clearInterval(timer);
  }, [total]);

  return (
    <div className="relative max-w-4xl mx-auto">
      {/* Mobile: horizontal scroll */}
      <div className="md:hidden overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div className="flex gap-4 pb-4" style={{ width: 'max-content' }}>
          {testimonials.map((t, i) => (
            <div key={t.slug} className="w-72 flex-none">
              <TestimonialCard t={t} highlighted={i === current} />
            </div>
          ))}
        </div>
      </div>

      {/* Desktop: 3-col grid with highlighted center */}
      <div className="hidden md:grid md:grid-cols-3 gap-6 mb-8 items-center">
        {testimonials.slice(0, 3).map((t, i) => (
          <TestimonialCard key={t.slug} t={t} highlighted={i === current % Math.min(3, total)} />
        ))}
      </div>

      {/* Dot navigation */}
      <div className="flex justify-center gap-2 mt-6">
        {testimonials.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className="h-2 rounded-full transition-all duration-300"
            style={{
              width: i === current ? '2rem' : '0.5rem',
              background: i === current ? 'var(--color-accent)' : 'rgba(255,255,255,0.5)',
            }}
            aria-label={`Go to testimonial ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
