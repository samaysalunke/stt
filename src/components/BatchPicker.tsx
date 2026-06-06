import { useState } from 'react';

interface Batch {
  id: string;
  startDate: string;
  endDate: string;
  price: number;
  totalSpots: number;
  bookedSpots: number;
  status?: string;
}

interface Props {
  batches: Batch[];
  tripSlug: string;
  onSelect?: (batch: Batch) => void;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function BatchPicker({ batches, tripSlug, onSelect }: Props) {
  const [selected, setSelected] = useState<string>(batches[0]?.id ?? '');

  const handleSelect = (batch: Batch) => {
    setSelected(batch.id);
    onSelect?.(batch);
    if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', 'select_batch', { batch_id: batch.id });
    }
  };

  return (
    <div className="space-y-3">
      {batches.map((batch) => {
        const spotsLeft = batch.totalSpots - batch.bookedSpots;
        const isSelected = selected === batch.id;
        const isSoldOut = spotsLeft <= 0 || batch.status === 'sold-out' || batch.status === 'sold_out';

        return (
          <button
            key={batch.id}
            onClick={() => !isSoldOut && handleSelect(batch)}
            disabled={isSoldOut}
            className="w-full text-left rounded-xl border-2 p-4 transition-all duration-150"
            style={{
              borderColor: isSelected ? '#E8725A' : '#E8DDD9',
              background: isSelected ? '#FDF0EC' : 'white',
              opacity: isSoldOut ? 0.5 : 1,
              cursor: isSoldOut ? 'not-allowed' : 'pointer',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm" style={{ color: '#1B2B3A', fontFamily: 'var(--font-display)' }}>
                  {formatDate(batch.startDate)} – {formatDate(batch.endDate)}
                </div>
                <div className="text-xs mt-1" style={{ color: '#6B7280' }}>
                  {isSoldOut ? 'Sold out' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="font-bold text-base" style={{ color: '#E8725A', fontFamily: 'var(--font-display)' }}>
                  ₹{batch.price.toLocaleString('en-IN')}
                </div>
                <div className="text-xs" style={{ color: '#6B7280' }}>per person</div>
              </div>
            </div>

            {!isSoldOut && (
              <div className="mt-3">
                <div className="flex justify-between text-xs mb-1" style={{ color: '#6B7280' }}>
                  <span>{batch.bookedSpots}/{batch.totalSpots} booked</span>
                  <span style={spotsLeft <= 4 ? { color: '#E8725A', fontWeight: 600 } : {}}>{spotsLeft} left</span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#F5DDD7' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (batch.bookedSpots / batch.totalSpots) * 100)}%`,
                      background: spotsLeft <= 4 ? '#E8725A' : '#1B2B3A',
                    }}
                  />
                </div>
              </div>
            )}

            {isSelected && !isSoldOut && (
              <div className="mt-3 flex justify-end">
                <a
                  href={`/trips/${tripSlug}/?batch=${batch.id}#register`}
                  className="text-xs font-semibold text-white px-3 py-1.5 rounded-full"
                  style={{ background: '#D95F3B' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Save my spot →
                </a>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
