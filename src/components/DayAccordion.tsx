import { useEffect, useRef, useState } from 'react';
import 'glightbox/dist/css/glightbox.css';

interface DayPhoto {
  image: string;
  width: number | null;
  height: number | null;
}

interface ItineraryDay {
  day: number;
  title: string;
  description: string;
  stay?: string;
  meals?: string[];
  transport?: string;
  note?: string;
  photos?: DayPhoto[];
}

interface Props {
  itinerary: ItineraryDay[];
  tripName?: string;
}

export default function DayAccordion({ itinerary, tripName }: Props) {
  const [openDay, setOpenDay] = useState<number>(itinerary[0]?.day ?? 1);
  const hasPhotos = itinerary.some((d) => d.photos && d.photos.length > 0);
  const lightbox = useRef<any>(null);

  // Re-init glightbox whenever the open day changes — only that day's photo
  // links are in the DOM (the accordion body unmounts on collapse).
  useEffect(() => {
    if (!hasPhotos) return;
    let cancelled = false;
    import('glightbox').then(({ default: GLightbox }) => {
      if (cancelled) return;
      lightbox.current?.destroy?.();
      lightbox.current = GLightbox({ selector: '[data-glightbox]', touchNavigation: true, loop: true });
    });
    return () => {
      cancelled = true;
      lightbox.current?.destroy?.();
      lightbox.current = null;
    };
  }, [openDay, hasPhotos]);

  return (
    <div className="space-y-2">
      {itinerary.map((day) => {
        const isOpen = openDay === day.day;
        return (
          <div
            key={day.day}
            className="rounded-xl overflow-hidden border transition-all duration-200"
            style={{ borderColor: isOpen ? '#E8725A' : '#E8DDD9' }}
          >
            <button
              onClick={() => setOpenDay(isOpen ? -1 : day.day)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              style={{ background: isOpen ? '#FDF0EC' : 'white' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: isOpen ? '#E8725A' : '#F5DDD7', color: isOpen ? 'white' : '#1B2B3A' }}
                >
                  {day.day}
                </span>
                <span className="font-semibold text-sm truncate" style={{ fontFamily: 'var(--font-display)', color: '#1B2B3A' }}>
                  {day.title}
                </span>
              </div>
              <svg
                className="flex-shrink-0 w-4 h-4 transition-transform duration-200"
                style={{ transform: isOpen ? 'rotate(180deg)' : 'none', color: '#6B7280' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="px-5 pb-5 pt-1" style={{ background: 'white' }}>
                {day.photos && day.photos.length > 0 && (
                  <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-xl mb-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {day.photos.map((p, i) => (
                      <a
                        key={p.image}
                        href={p.image}
                        data-glightbox="type: image"
                        data-gallery={`day-${day.day}`}
                        className={day.photos!.length > 1 ? 'block w-[88%] shrink-0 snap-start' : 'block w-full shrink-0 snap-start'}
                      >
                        <img
                          src={p.image}
                          loading="lazy"
                          width={p.width ?? undefined}
                          height={p.height ?? undefined}
                          style={{ aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : '4 / 3' }}
                          className="w-full max-h-[75vh] object-contain rounded-xl bg-neutral-100"
                          alt={[tripName, `Day ${day.day}, photo ${i + 1}`].filter(Boolean).join(' — ')}
                        />
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-sm leading-relaxed mb-4" style={{ color: '#6B7280' }}>
                  {day.description}
                </p>

                {/* Chips */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {day.stay && (
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#F5F5F3', color: '#1B2B3A' }}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      {day.stay}
                    </span>
                  )}
                  {day.transport && (
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#F5F5F3', color: '#1B2B3A' }}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17a2 2 0 11-4 0 2 2 0 014 0zM20 17a2 2 0 11-4 0 2 2 0 014 0zM4 17H2v-4l2-5h12l3 5v4h-2M16 17H8" />
                      </svg>
                      {day.transport}
                    </span>
                  )}
                  {(day.meals ?? []).length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: '#F5F5F3', color: '#1B2B3A' }}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 3v5a2 2 0 002 2h0a2 2 0 002-2V3M6 10v11M18 3c-1.657 0-3 2.239-3 5s1.343 4 3 4m0 0v9m0-9V3" />
                      </svg>
                      {(day.meals ?? []).join(' · ')}
                    </span>
                  )}
                </div>

                {day.note && (
                  <div
                    className="text-xs leading-relaxed px-3 py-2.5 rounded-lg"
                    style={{ borderLeft: '3px solid #E8725A', background: '#FDF0EC', color: '#1B2B3A' }}
                  >
                    {day.note}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
