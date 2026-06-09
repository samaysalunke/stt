import { useState, useEffect } from 'react';

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

function dispatchSelected(batch: Batch) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('stt:batch-selected', {
    detail: { id: batch.id, startDate: batch.startDate, endDate: batch.endDate, price: batch.price },
  }));
}

export default function BatchPicker({ batches, tripSlug, onSelect }: Props) {
  const firstBookable = batches.find(
    (b) => b.totalSpots - b.bookedSpots > 0 && b.status !== 'sold-out' && b.status !== 'sold_out'
  ) ?? batches[0];
  const [selected, setSelected] = useState<string>(firstBookable?.id ?? '');

  useEffect(() => {
    if (firstBookable) dispatchSelected(firstBookable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (batch: Batch) => {
    setSelected(batch.id);
    onSelect?.(batch);
    dispatchSelected(batch);
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
        const isLowStock = !isSoldOut && spotsLeft <= 3;

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
            <div className="font-semibold text-sm" style={{ color: '#1B2B3A', fontFamily: 'var(--font-display)' }}>
              {formatDate(batch.startDate)} – {formatDate(batch.endDate)}
            </div>

            {isSoldOut ? (
              <div className="text-xs mt-1" style={{ color: '#6B7280' }}>Sold out</div>
            ) : (
              <div className="mt-3">
                <div
                  className="text-xs mb-1"
                  style={{ color: isLowStock ? '#E8725A' : '#6B7280', fontWeight: isLowStock ? 600 : 400 }}
                >
                  {isLowStock
                    ? `Only ${spotsLeft} left`
                    : `${spotsLeft} of ${batch.totalSpots} left`}
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#F5DDD7' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (batch.bookedSpots / batch.totalSpots) * 100)}%`,
                      background: isLowStock ? '#E8725A' : '#1B2B3A',
                    }}
                  />
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
