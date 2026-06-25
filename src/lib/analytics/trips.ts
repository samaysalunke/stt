import { listTrips } from '../trips';
import { editableBooking } from '../tripEditor';

export interface AnalyticsTrip {
  slug: string;
  title: string;
  location: string;
  status: string;
  departures: AnalyticsDeparture[];
}

export interface AnalyticsDeparture {
  id: string;
  tripSlug: string;
  tripTitle: string;
  startDate: string;
  endDate: string;
  status: string;
  capacity: number | null;
  booked: number;
}

export function getAnalyticsTrips(): AnalyticsTrip[] {
  return listTrips().map((trip: any) => {
    const { editorDepartures } = editableBooking(trip);
    const title = String(trip.title || trip.name || trip.slug);
    const slug = String(trip.slug);
    return {
      slug,
      title,
      location: String(trip.location || ''),
      status: String(trip.status || trip.publicationStatus || ''),
      departures: editorDepartures.map((departure) => {
        const capacity = departure.offers.length > 0 && departure.offers.every((o) => o.cap != null)
          ? departure.offers.reduce((sum, offer) => sum + Number(offer.cap || 0), 0)
          : null;
        return {
          id: departure.id,
          tripSlug: slug,
          tripTitle: title,
          startDate: departure.startDate,
          endDate: departure.endDate,
          status: departure.status,
          capacity,
          booked: departure.offers.reduce((sum, offer) => sum + Number(offer.booked || 0), 0),
        };
      }),
    };
  });
}

export function findTripBySlug(slug: string): AnalyticsTrip | null {
  return getAnalyticsTrips().find((trip) => trip.slug === slug) ?? null;
}

export function findDepartureById(id: string): AnalyticsDeparture | null {
  for (const trip of getAnalyticsTrips()) {
    const dep = trip.departures.find((departure) => departure.id === id);
    if (dep) return dep;
  }
  return null;
}

export function findTripsByText(query: string): AnalyticsTrip[] {
  const q = normalize(query);
  if (!q) return [];
  return getAnalyticsTrips()
    .map((trip) => {
      const haystack = normalize(`${trip.title} ${trip.slug} ${trip.location}`);
      const score = haystack.includes(q) ? 3 : q.split(' ').filter((part) => haystack.includes(part)).length;
      return { trip, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.trip.title.localeCompare(b.trip.title))
    .map((item) => item.trip);
}

export function normalize(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
