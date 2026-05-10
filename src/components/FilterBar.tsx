import { useState, useMemo } from 'react';

interface Trip {
  slug: string;
  name: string;
  status: string;
  featuredImage: string | null;
  shortDescription: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: string | null;
  pricePerPerson: number | null;
  maxGroupSize: number | null;
  currentBookings: number | null;
  difficulty: string | null;
  categories: string[];
}

interface Props {
  trips: Trip[];
}

const STATUS_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Booking Open', value: 'booking-open' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Sold Out', value: 'sold-out' },
  { label: 'Past Trips', value: 'completed' },
];

const SORT_OPTIONS = [
  { label: 'Date (Earliest)', value: 'date-asc' },
  { label: 'Price: Low → High', value: 'price-asc' },
  { label: 'Price: High → Low', value: 'price-desc' },
];

const DURATION_OPTIONS = [
  { label: 'All Durations', value: 'all' },
  { label: 'Weekend (1–3 days)', value: 'weekend' },
  { label: 'Week-long (4–7 days)', value: 'week-long' },
  { label: 'Extended (8+ days)', value: 'extended' },
];

const DIFFICULTY_OPTIONS = [
  { label: 'All Levels', value: 'all' },
  { label: 'Easy', value: 'Easy' },
  { label: 'Moderate', value: 'Moderate' },
  { label: 'Challenging', value: 'Challenging' },
];

const STATUS_COLORS: Record<string, string> = {
  'booking-open': '#166534',
  'upcoming': '#1e40af',
  'sold-out': '#991b1b',
  'completed': '#374151',
  'draft': '#713f12',
};

const STATUS_BG: Record<string, string> = {
  'booking-open': '#dcfce7',
  'upcoming': '#dbeafe',
  'sold-out': '#fee2e2',
  'completed': '#f3f4f6',
  'draft': '#fef9c3',
};

const STATUS_LABELS: Record<string, string> = {
  'booking-open': 'Booking Open',
  'upcoming': 'Upcoming',
  'sold-out': 'Sold Out',
  'completed': 'Completed',
};

const DIFF_COLORS: Record<string, { border: string; text: string }> = {
  'Easy': { border: '#22A654', text: '#166534' },
  'Moderate': { border: '#E8752A', text: '#c2500e' },
  'Challenging': { border: '#D93025', text: '#991b1b' },
};

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: string | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function TripCard({ trip }: { trip: Trip }) {
  const seatsLeft = trip.maxGroupSize && trip.currentBookings != null
    ? trip.maxGroupSize - trip.currentBookings
    : null;
  const diff = trip.difficulty ? DIFF_COLORS[trip.difficulty] : null;

  return (
    <article className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col group">
      <a href={`/trips/${trip.slug}/`} className="block relative overflow-hidden" style={{ height: '200px' }}>
        <img
          src={trip.featuredImage ?? 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&auto=format&fit=crop&q=80'}
          alt={trip.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute top-3 left-3">
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide"
            style={{ backgroundColor: STATUS_BG[trip.status] ?? '#f3f4f6', color: STATUS_COLORS[trip.status] ?? '#374151' }}
          >
            {STATUS_LABELS[trip.status] ?? trip.status}
          </span>
        </div>
        {seatsLeft !== null && seatsLeft <= 5 && seatsLeft > 0 && (
          <div className="absolute top-3 right-3">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold text-white" style={{ backgroundColor: 'var(--color-danger, #D93025)' }}>
              {seatsLeft} left!
            </span>
          </div>
        )}
      </a>

      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-bold text-base sm:text-lg leading-snug mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          <a href={`/trips/${trip.slug}/`} className="hover:opacity-80 transition-opacity">{trip.name}</a>
        </h3>

        <div className="space-y-1.5 text-xs sm:text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          {trip.location && (
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{trip.location}</span>
            </div>
          )}
          {trip.startDate && (
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{formatDate(trip.startDate)}</span>
            </div>
          )}
          {trip.duration && (
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{trip.duration}</span>
            </div>
          )}
          {trip.maxGroupSize && (
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{trip.maxGroupSize} max</span>
            </div>
          )}
        </div>

        {trip.difficulty && diff && (
          <div className="mb-3">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full border"
              style={{ borderColor: diff.border, color: diff.text }}
            >
              {trip.difficulty}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t mt-auto" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            {trip.pricePerPerson ? (
              <div>
                <span className="text-xl font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent)' }}>
                  {formatINR(trip.pricePerPerson)}
                </span>
                <span className="text-xs ml-1" style={{ color: 'var(--color-text-secondary)' }}>/ person</span>
              </div>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Price TBD</span>
            )}
          </div>
          <a
            href={`/trips/${trip.slug}/`}
            className="inline-flex items-center gap-1 text-sm font-medium transition-colors hover:opacity-70"
            style={{ color: 'var(--color-accent)' }}
          >
            View
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </article>
  );
}

export default function FilterBar({ trips }: Props) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [durationFilter, setDurationFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-asc');
  const [visibleCount, setVisibleCount] = useState(9);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const destinations = useMemo(() => {
    const locs = trips.map((t) => t.location).filter(Boolean) as string[];
    return Array.from(new Set(locs)).sort();
  }, [trips]);
  const [destinationFilter, setDestinationFilter] = useState('all');

  const filtered = useMemo(() => {
    let result = trips;

    if (statusFilter !== 'all') result = result.filter((t) => t.status === statusFilter);

    if (destinationFilter !== 'all') result = result.filter((t) => t.location === destinationFilter);

    if (durationFilter !== 'all') {
      result = result.filter((t) => t.categories.includes(durationFilter));
    }

    if (difficultyFilter !== 'all') {
      result = result.filter((t) => t.difficulty === difficultyFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.shortDescription.toLowerCase().includes(q) ||
          (t.location ?? '').toLowerCase().includes(q) ||
          t.categories.some((c) => c.includes(q))
      );
    }

    result = [...result].sort((a, b) => {
      if (sort === 'date-asc') return (a.startDate ?? '').localeCompare(b.startDate ?? '');
      if (sort === 'price-asc') return (a.pricePerPerson ?? 0) - (b.pricePerPerson ?? 0);
      if (sort === 'price-desc') return (b.pricePerPerson ?? 0) - (a.pricePerPerson ?? 0);
      return 0;
    });

    return result;
  }, [trips, statusFilter, destinationFilter, durationFilter, difficultyFilter, search, sort]);

  const visible = filtered.slice(0, visibleCount);

  const resetFilters = () => {
    setStatusFilter('all');
    setDestinationFilter('all');
    setDurationFilter('all');
    setDifficultyFilter('all');
    setSearch('');
    setVisibleCount(9);
  };

  return (
    <div>
      {/* Mobile search + filter toggle */}
      <div className="lg:hidden sticky top-16 z-40 bg-white shadow-sm border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex gap-2">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search trips..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(9); }}
              className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm outline-none"
              style={{ borderColor: 'var(--color-border)' }}
            />
          </div>
          <button
            onClick={() => setShowMobileFilters(true)}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium flex-shrink-0"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>
        </div>
      </div>

      {/* Mobile bottom-sheet filters */}
      {showMobileFilters && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setShowMobileFilters(false)} />
          <div className="fixed inset-x-0 bottom-0 bg-white z-50 lg:hidden rounded-t-3xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-4 py-4 flex items-center justify-between rounded-t-3xl" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="font-semibold">Filters</h3>
              <button onClick={() => setShowMobileFilters(false)} className="p-2 -mr-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-6">
              <div>
                <label className="block text-sm font-medium mb-3">Trip Status</label>
                <div className="flex flex-wrap gap-2">
                  {STATUS_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => setStatusFilter(tab.value)}
                      className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
                      style={{
                        backgroundColor: statusFilter === tab.value ? 'var(--color-accent)' : 'transparent',
                        color: statusFilter === tab.value ? 'white' : 'var(--color-text-secondary)',
                        border: statusFilter === tab.value ? 'none' : '1px solid var(--color-border)',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              {destinations.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-2">Destination</label>
                  <select value={destinationFilter} onChange={(e) => setDestinationFilter(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--color-border)' }}>
                    <option value="all">All Destinations</option>
                    {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-2">Difficulty</label>
                <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--color-border)' }}>
                  {DIFFICULTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Duration</label>
                <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm outline-none" style={{ borderColor: 'var(--color-border)' }}>
                  {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { resetFilters(); setShowMobileFilters(false); }}
                  className="flex-1 py-3 border rounded-full text-sm font-medium" style={{ borderColor: 'var(--color-border)' }}>
                  Clear All
                </button>
                <button onClick={() => setShowMobileFilters(false)}
                  className="flex-1 py-3 rounded-full text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-accent)' }}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Desktop filter bar */}
      <div className="hidden lg:block sticky top-20 z-40 bg-white shadow-sm border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Status tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => { setStatusFilter(tab.value); setVisibleCount(9); }}
                className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
                style={{
                  backgroundColor: statusFilter === tab.value ? 'var(--color-accent)' : 'transparent',
                  color: statusFilter === tab.value ? 'white' : 'var(--color-text-secondary)',
                  border: statusFilter === tab.value ? 'none' : '1px solid var(--color-border)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* Search + dropdowns */}
          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-2 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search trips or destinations..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVisibleCount(9); }}
                className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm outline-none"
                style={{ borderColor: 'var(--color-border)' }}
              />
            </div>
            <select value={destinationFilter} onChange={(e) => { setDestinationFilter(e.target.value); setVisibleCount(9); }}
              className="border rounded-lg px-3 py-2 text-sm outline-none cursor-pointer" style={{ borderColor: 'var(--color-border)' }}>
              <option value="all">All Destinations</option>
              {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={durationFilter} onChange={(e) => { setDurationFilter(e.target.value); setVisibleCount(9); }}
              className="border rounded-lg px-3 py-2 text-sm outline-none cursor-pointer" style={{ borderColor: 'var(--color-border)' }}>
              {DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={difficultyFilter} onChange={(e) => { setDifficultyFilter(e.target.value); setVisibleCount(9); }}
              className="border rounded-lg px-3 py-2 text-sm outline-none cursor-pointer" style={{ borderColor: 'var(--color-border)' }}>
              {DIFFICULTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm outline-none cursor-pointer" style={{ borderColor: 'var(--color-border)' }}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <strong>{filtered.length}</strong> {filtered.length === 1 ? 'trip' : 'trips'} found
          {statusFilter !== 'all' ? ` · ${STATUS_TABS.find((t) => t.value === statusFilter)?.label}` : ''}
          {search ? ` matching "${search}"` : ''}
        </p>
      </div>

      {/* Trip grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {visible.length > 0 ? (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
              {visible.map((trip) => (
                <TripCard key={trip.slug} trip={trip} />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="text-center mt-10">
                <button
                  onClick={() => setVisibleCount((c) => c + 9)}
                  className="font-bold px-8 py-3 rounded-full border-2 transition-all"
                  style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-primary)'; (e.currentTarget as HTMLButtonElement).style.color = 'white'; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-primary)'; }}
                >
                  Load More ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20">
            <svg className="w-16 h-16 mx-auto mb-6" style={{ color: 'var(--color-border)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>No trips found</h3>
            <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>Try adjusting your filters.</p>
            <button
              onClick={resetFilters}
              className="font-bold text-white px-6 py-3 rounded-full transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              View All Trips
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
