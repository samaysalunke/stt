// Display rules for the public urgency / social-proof lines. Pure and free of
// node imports: the BookingPanel client island imports this.

/** "Only N spots left" shows for 1..LOW_STOCK_BELOW-1 spots. */
export const LOW_STOCK_BELOW = 5;
/** Below this the women count is hidden, so one traveller can't be identified. */
export const WOMEN_MIN_SHOWN = 2;

/** Seats left against confirmed bookings; null when the departure has no cap. */
export function liveSpotsLeft(totalCap: number | null | undefined, confirmed: number): number | null {
  if (totalCap == null || !(totalCap > 0)) return null;
  return Math.max(0, totalCap - confirmed);
}

/** The spot count to show, or null when the line should not render. */
export function lowStockSpots(d: {
  liveSpotsLeft?: number | null;
  soldOut: boolean;
  comingSoon?: boolean;
}): number | null {
  const n = d.liveSpotsLeft;
  if (d.soldOut || d.comingSoon || n == null) return null;
  return n >= 1 && n < LOW_STOCK_BELOW ? n : null;
}

export function spotsLeftLabel(n: number): string {
  return `Only ${n} ${n === 1 ? 'spot' : 'spots'} left`;
}

export function womenBookedLabel(n: number | null | undefined): string | null {
  if (n == null || n < WOMEN_MIN_SHOWN) return null;
  return `${n} women already booked`;
}
