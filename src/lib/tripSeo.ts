const TITLE_SUFFIX = ' | Seek the Thrill';

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const shortened = value.slice(0, Math.max(1, maxLength - 1));
  const lastSpace = shortened.lastIndexOf(' ');
  const cleanCut = lastSpace >= Math.floor(maxLength * 0.65)
    ? shortened.slice(0, lastSpace)
    : shortened;
  return `${cleanCut.replace(/[\s,;:–—-]+$/g, '')}…`;
}

export interface TripSeoSource {
  title?: unknown;
  name?: unknown;
  location?: unknown;
  shortDescription?: unknown;
  description?: unknown;
}

/**
 * Generates the SEO copy maintained by the trip editor from fields editors
 * already need to complete. Keeping this deterministic prevents metadata from
 * becoming stale when a trip name, destination, or summary changes.
 */
export function generateTripSeo(trip: TripSeoSource) {
  const name = cleanText(trip.title || trip.name) || 'Group Trip';
  const location = cleanText(trip.location);
  const nameIncludesLocation = location
    ? name.toLocaleLowerCase('en-IN').includes(location.toLocaleLowerCase('en-IN'))
    : false;
  const availableTitleLength = 70 - TITLE_SUFFIX.length;
  const subjectWithLocation = location && !nameIncludesLocation ? `${name} — ${location}` : name;
  // Prefer the complete trip name over a truncated destination suffix. This
  // keeps search titles readable for trips with longer, itinerary-specific names.
  const titleSubject = subjectWithLocation.length <= availableTitleLength
    ? subjectWithLocation
    : name;
  const seoTitle = `${truncate(titleSubject, availableTitleLength)}${TITLE_SUFFIX}`;

  const suppliedDescription = cleanText(trip.shortDescription || trip.description);
  const fallbackDescription = `Join ${name}${location && !nameIncludesLocation ? ` in ${location}` : ''} — an offbeat small-group trip with Seek the Thrill.`;
  const seoDescription = truncate(suppliedDescription || fallbackDescription, 170);

  const imageAlt = truncate(
    `${name} group trip${location && !nameIncludesLocation ? ` in ${location}` : ''}`,
    180,
  );

  return { seoTitle, seoDescription, imageAlt };
}
