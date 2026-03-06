import { useState, useMemo } from 'react';

interface Trip {
  slug: string;
  name: string;
  status: string;
  featuredImage: string | null;
  shortDescription: string;
  startDate: string | null;
  endDate: string | null;
  duration: string | null;
  pricePerPerson: number | null;
  difficulty: string | null;
  maxGroupSize: number | null;
  currentBookings: number | null;
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

const DIFFICULTY_OPTIONS = [
  { label: 'Any Difficulty', value: '' },
  { label: 'Easy', value: 'easy' },
  { label: 'Moderate', value: 'moderate' },
  { label: 'Challenging', value: 'challenging' },
  { label: 'Moderate–Challenging', value: 'moderate-challenging' },
];

const DURATION_OPTIONS = [
  { label: 'Any Duration', value: '' },
  { label: 'Weekend (1-3 days)', value: 'weekend' },
  { label: 'Week-long (4-7 days)', value: 'week-long' },
  { label: 'Extended (8+ days)', value: 'extended' },
];

const SORT_OPTIONS = [
  { label: 'Date (Earliest)', value: 'date-asc' },
  { label: 'Price: Low → High', value: 'price-asc' },
  { label: 'Price: High → Low', value: 'price-desc' },
  { label: 'Newest Added', value: 'newest' },
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

const DIFF_LABELS: Record<string, string> = {
  'easy': 'Easy',
  'moderate': 'Moderate',
  'challenging': 'Challenging',
  'moderate-challenging': 'Mod–Challenging',
};

const DIFF_COLORS: Record<string, { bg: string; text: string }> = {
  easy: { bg: '#dcfce7', text: '#166534' },
  moderate: { bg: '#fef9c3', text: '#854d0e' },
  challenging: { bg: '#fee2e2', text: '#991b1b' },
  'moderate-challenging': { bg: '#ffedd5', text: '#9a3412' },
};

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function formatDate(d: string | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function TripCardMini({ trip }: { trip: Trip }) {
  const seatsLeft = trip.maxGroupSize && trip.currentBookings != null
    ? trip.maxGroupSize - trip.currentBookings
    : null;

  return (
    <article className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col group">
      <a href={`/trips/${trip.slug}/`} className="block relative overflow-hidden" style={{ aspectRatio: '16/10' }}>
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
        {trip.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {trip.categories.slice(0, 3).map((cat) => (
              <span key={cat} className="text-xs font-medium px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: '#E8F5EC', color: '#2D5F3E' }}>
                {cat}
              </span>
            ))}
          </div>
        )}

        <h3 className="font-bold text-lg leading-snug mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          <a href={`/trips/${trip.slug}/`} className="hover:opacity-80 transition-opacity">{trip.name}</a>
        </h3>

        <p className="text-sm leading-relaxed mb-4 flex-1" style={{ color: 'var(--color-text-secondary)' }}>
          {trip.shortDescription}
        </p>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          {trip.startDate && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDate(trip.startDate)}
            </span>
          )}
          {trip.duration && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {trip.duration}
            </span>
          )}
          {trip.difficulty && (
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide"
              style={{
                backgroundColor: DIFF_COLORS[trip.difficulty]?.bg ?? '#f3f4f6',
                color: DIFF_COLORS[trip.difficulty]?.text ?? '#374151'
              }}
            >
              {DIFF_LABELS[trip.difficulty] ?? trip.difficulty}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            {trip.pricePerPerson ? (
              <div>
                <span className="text-xl font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
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
            className="font-bold text-sm text-white px-4 py-2 rounded-lg transition-all hover:opacity-90"
            style={{ backgroundColor: trip.status === 'sold-out' ? '#5C5C5C' : 'var(--color-accent)' }}
          >
            {trip.status === 'sold-out' ? 'View Details' : 'Book Now →'}
          </a>
        </div>
      </div>
    </article>
  );
}

export default function FilterBar({ trips }: Props) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [durationFilter, setDurationFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-asc');
  const [visibleCount, setVisibleCount] = useState(9);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    let result = trips;

    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter);
    }

    if (difficultyFilter) {
      result = result.filter((t) => t.difficulty === difficultyFilter);
    }

    if (durationFilter) {
      result = result.filter((t) => t.categories.includes(durationFilter));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.shortDescription.toLowerCase().includes(q) ||
          t.categories.some((c) => c.includes(q))
      );
    }

    result = [...result].sort((a, b) => {
      if (sort === 'date-asc') {
        return (a.startDate ?? '').localeCompare(b.startDate ?? '');
      } else if (sort === 'price-asc') {
        return (a.pricePerPerson ?? 0) - (b.pricePerPerson ?? 0);
      } else if (sort === 'price-desc') {
        return (b.pricePerPerson ?? 0) - (a.pricePerPerson ?? 0);
      }
      return 0;
    });

    return result;
  }, [trips, statusFilter, difficultyFilter, durationFilter, search, sort]);

  const visible = filtered.slice(0, visibleCount);

  return (
    <div>
      {/* Status tabs */}
      <div className="sticky top-16 lg:top-20 z-30 bg-white border-b shadow-sm" style={{ borderColor: 'var(--color-border)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-3 gap-4">
            <div className="flex gap-2 overflow-x-auto no-scrollbar flex-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => { setStatusFilter(tab.value); setVisibleCount(9); }}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0"
                  style={{
                    backgroundColor: statusFilter === tab.value ? 'var(--color-primary)' : 'transparent',
                    color: statusFilter === tab.value ? 'white' : 'var(--color-text-secondary)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Desktop filters row */}
            <div className="hidden md:flex items-center gap-3 flex-shrink-0">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="search"
                  placeholder="Search trips..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setVisibleCount(9); }}
                  className="pl-9 pr-4 py-2 border rounded-lg text-sm outline-none w-44"
                  style={{ borderColor: 'var(--color-border)' }}
                />
              </div>

              <select
                value={difficultyFilter}
                onChange={(e) => { setDifficultyFilter(e.target.value); setVisibleCount(9); }}
                className="border rounded-lg px-3 py-2 text-sm outline-none cursor-pointer"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {DIFFICULTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm outline-none cursor-pointer"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Mobile filter toggle */}
            <button
              className="md:hidden flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium flex-shrink-0"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
              onClick={() => setShowFilters(!showFilters)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
            </button>
          </div>

          {/* Mobile filter panel */}
          {showFilters && (
            <div className="md:hidden pb-4 flex flex-col gap-3">
              <input
                type="search"
                placeholder="Search trips..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVisibleCount(9); }}
                className="px-4 py-2 border rounded-lg text-sm outline-none"
                style={{ borderColor: 'var(--color-border)' }}
              />
              <select
                value={difficultyFilter}
                onChange={(e) => { setDifficultyFilter(e.target.value); setVisibleCount(9); }}
                className="border rounded-lg px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {DIFFICULTY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--color-border)' }}
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Showing <strong>{filtered.length}</strong> {filtered.length === 1 ? 'trip' : 'trips'}
          {statusFilter !== 'all' ? ` · ${STATUS_TABS.find(t => t.value === statusFilter)?.label}` : ''}
          {search ? ` matching "${search}"` : ''}
        </p>
      </div>

      {/* Trip grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {visible.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visible.map((trip) => (
                <TripCardMini key={trip.slug} trip={trip} />
              ))}
            </div>

            {visibleCount < filtered.length && (
              <div className="text-center mt-10">
                <button
                  onClick={() => setVisibleCount((c) => c + 9)}
                  className="font-bold px-8 py-3 rounded-xl border-2 transition-all"
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>No trips found</h3>
            <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>
              No trips match your current filters. Try adjusting your search.
            </p>
            <button
              onClick={() => { setStatusFilter('all'); setDifficultyFilter(''); setDurationFilter(''); setSearch(''); }}
              className="font-bold text-white px-6 py-3 rounded-xl transition-all hover:opacity-90"
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
