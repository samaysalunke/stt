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
        <svg
          key={i}
          className="w-4 h-4"
          fill={i < rating ? '#D4A854' : '#e5e7eb'}
          viewBox="0 0 24 24"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

export default function TestimonialCarousel({ testimonials }: Props) {
  const [current, setCurrent] = useState(0);
  const total = testimonials.length;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((c) => (c + 1) % total);
    }, 5000);
    return () => clearInterval(timer);
  }, [total]);

  const prev = () => setCurrent((c) => (c - 1 + total) % total);
  const next = () => setCurrent((c) => (c + 1) % total);

  // Show 1 on mobile, up to 3 on desktop
  const getVisible = () => {
    const visible = [];
    for (let i = 0; i < Math.min(3, total); i++) {
      visible.push(testimonials[(current + i) % total]);
    }
    return visible;
  };

  const visible = getVisible();

  return (
    <div className="relative">
      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {visible.map((t, i) => (
          <div
            key={t.slug}
            className={`bg-white rounded-xl p-6 shadow-md transition-all duration-500 ${
              i === 0 ? 'opacity-100' : 'opacity-90'
            }`}
          >
            <StarRating rating={t.rating} />
            <p className="text-gray-700 italic leading-relaxed mb-5 text-sm">
              "{t.quote}"
            </p>
            <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
              {t.photo ? (
                <img
                  src={t.photo}
                  alt={t.name}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                />
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
                  {t.location} · {t.tripName}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={prev}
          className="w-10 h-10 rounded-full border-2 border-white/30 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
          aria-label="Previous testimonial"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex gap-2">
          {testimonials.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className="w-2 h-2 rounded-full transition-all duration-300"
              style={{ background: i === current ? 'var(--color-accent)' : 'rgba(255,255,255,0.4)' }}
              aria-label={`Go to testimonial ${i + 1}`}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-10 h-10 rounded-full border-2 border-white/30 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
          aria-label="Next testimonial"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
