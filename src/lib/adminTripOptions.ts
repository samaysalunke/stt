import { listTrips } from './content';
import { editableBooking } from './tripEditor';

// Trip → departure → occupancy options for the admin "add registration" screens.
// Built from editableBooking (not resolveBooking) so EVERY departure is included,
// past ones too — that's what enables historical back-fill. Each departure is
// flagged `past` so the UI can hide them unless back-fill is requested.

export interface TripOptionOffer { tierId: string; label: string; price: number }
export interface TripOptionDeparture {
  id: string;
  label: string;
  past: boolean;
  offers: TripOptionOffer[];
}
export interface TripOption {
  slug: string;
  name: string;
  hasUpcoming: boolean;
  departures: TripOptionDeparture[];
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function buildTripOptions(): TripOption[] {
  const now = Date.now();

  return listTrips()
    // Published trips only — trip-level status is gone, so "published" means the
    // trip has at least one non-draft departure (legacy single-date trips always).
    .filter((t: any) => {
      const bs = Array.isArray(t.batches) ? t.batches : [];
      return bs.length === 0 || bs.some((b: any) => b.status !== 'draft');
    })
    .map((t: any) => {
      const { editorCatalog, editorDepartures } = editableBooking(t);
      const labelByTier = Object.fromEntries(editorCatalog.map((c) => [c.id, c.label]));

      const departures: TripOptionDeparture[] = editorDepartures
        .filter((d) => d.startDate && d.offers.length > 0)
        .map((d) => {
          const endMs = new Date(d.endDate || d.startDate).getTime();
          const past = Number.isFinite(endMs) && endMs < now;
          return {
            id: d.id,
            label: `${fmtDate(d.startDate)} – ${fmtDate(d.endDate || d.startDate)}${past ? ' (past)' : ''}`,
            past,
            offers: d.offers.map((o) => ({
              tierId: o.tierId,
              label: labelByTier[o.tierId] ?? o.tierId,
              price: o.price ?? 0,
            })),
          };
        })
        // Soonest first, but past dates (most recent first) sink below upcoming.
        .sort((a, b) => Number(a.past) - Number(b.past));

      return {
        slug: t.slug as string,
        name: (t.title || t.name || t.slug) as string,
        hasUpcoming: departures.some((d) => !d.past),
        departures,
      };
    })
    .filter((t) => t.departures.length > 0);
}
