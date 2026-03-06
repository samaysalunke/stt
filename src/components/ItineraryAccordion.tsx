import { useState } from 'react';

interface Day {
  dayNumber: number;
  dayTitle: string;
  activities: string;
  accommodation: string;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  mealsNotes?: string;
  transport?: string;
  specialNotes?: string;
}

interface Props {
  itinerary: Day[];
}

function MealIcon({ included, label }: { included: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: included ? '#dcfce7' : '#f3f4f6',
        color: included ? '#166534' : '#9ca3af',
      }}
    >
      {label[0]}
    </span>
  );
}

export default function ItineraryAccordion({ itinerary }: Props) {
  const [openDay, setOpenDay] = useState(1);

  return (
    <div className="space-y-3">
      {itinerary.map((day, i) => {
        const isOpen = openDay === day.dayNumber;
        return (
          <div
            key={day.dayNumber}
            className="border rounded-xl overflow-hidden transition-all"
            style={{ borderColor: isOpen ? 'var(--color-accent)' : 'var(--color-border)' }}
          >
            <button
              className="w-full flex items-center justify-between p-4 lg:p-5 text-left transition-colors"
              style={{ backgroundColor: isOpen ? '#FFF3EC' : 'white' }}
              onClick={() => setOpenDay(isOpen ? 0 : day.dayNumber)}
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-4">
                <span
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-extrabold flex-shrink-0"
                  style={{
                    backgroundColor: isOpen ? 'var(--color-accent)' : 'var(--color-primary-light)',
                    color: isOpen ? 'white' : 'var(--color-primary)',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  {day.dayNumber}
                </span>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-accent)' }}>
                    Day {day.dayNumber}
                  </span>
                  <h4 className="font-bold text-base leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                    {day.dayTitle}
                  </h4>
                </div>
              </div>
              <svg
                className="w-5 h-5 flex-shrink-0 transition-transform duration-300"
                style={{ color: 'var(--color-text-secondary)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="px-4 lg:px-5 pb-5 bg-white border-t" style={{ borderColor: '#FFF3EC' }}>
                {/* Activities */}
                <p className="text-sm leading-relaxed mt-4 mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                  {day.activities}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Accommodation */}
                  {day.accommodation && (
                    <div className="flex items-start gap-2.5">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>Stay</div>
                        <div className="text-sm font-medium">{day.accommodation}</div>
                      </div>
                    </div>
                  )}

                  {/* Meals */}
                  <div className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Meals</div>
                      <div className="flex gap-1.5">
                        <MealIcon included={day.breakfast} label="Breakfast" />
                        <MealIcon included={day.lunch} label="Lunch" />
                        <MealIcon included={day.dinner} label="Dinner" />
                      </div>
                      {day.mealsNotes && <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{day.mealsNotes}</p>}
                    </div>
                  </div>

                  {/* Transport */}
                  {day.transport && (
                    <div className="flex items-start gap-2.5">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>Transport</div>
                        <div className="text-sm font-medium">{day.transport}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Special notes */}
                {day.specialNotes && (
                  <div className="mt-4 p-3 rounded-lg text-sm" style={{ backgroundColor: '#FFF3EC', color: '#9a3412' }}>
                    <span className="font-bold">Note: </span>{day.specialNotes}
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
