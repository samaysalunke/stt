import type { ResolvedDeparture } from './trips';

const MONTH = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDepartureRange(startValue: string, endValue?: string): string {
  const start = parseDate(startValue);
  const end = parseDate(endValue || startValue);
  if (!start || !end) return startValue;

  const startMonth = MONTH.format(start);
  const endMonth = MONTH.format(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  if (start.getTime() === end.getTime()) return `${startMonth} ${startDay}`;
  if (startYear !== endYear) return `${startMonth} ${startDay}, ${startYear} – ${endMonth} ${endDay}, ${endYear}`;
  if (start.getUTCMonth() === end.getUTCMonth()) return `${startMonth} ${startDay} – ${endDay}`;
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}

export function getDepartureSummary(departures: ResolvedDeparture[]) {
  const chronological = (a: ResolvedDeparture, b: ResolvedDeparture) => a.startDate.localeCompare(b.startDate);
  const bookingOpen = departures.filter((departure) => departure.status === 'booking-open');
  const available = bookingOpen.filter((departure) => !departure.soldOut).sort(chronological);
  const soldOut = bookingOpen.filter((departure) => departure.soldOut).sort(chronological);
  const displayed = available.slice(0, 2);
  if (displayed.length < 2) displayed.push(...soldOut.slice(0, 2 - displayed.length));

  return {
    displayed,
    moreAvailable: Math.max(0, available.length - displayed.filter((departure) => !departure.soldOut).length),
  };
}
