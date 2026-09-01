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
  // Show bookable dates (including manually labelled filling-fast dates) and
  // coming-soon dates. Other operational statuses stay out of public summaries.
  const relevant = departures.filter((d) => d.status === 'booking-open' || d.fillingFast || d.comingSoon);
  const available = relevant.filter((d) => !d.soldOut && !d.comingSoon).sort(chronological);
  const comingSoon = relevant.filter((d) => d.comingSoon).sort(chronological);
  const soldOut = relevant.filter((d) => d.soldOut && !d.comingSoon).sort(chronological);

  const displayed: ResolvedDeparture[] = available.slice(0, 2);
  if (displayed.length < 2) displayed.push(...comingSoon.slice(0, 2 - displayed.length));
  if (displayed.length < 2) displayed.push(...soldOut.slice(0, 2 - displayed.length));

  const shownAvailable = displayed.filter((d) => !d.soldOut && !d.comingSoon).length;
  const shownComingSoon = displayed.filter((d) => d.comingSoon).length;
  return {
    displayed,
    moreAvailable: Math.max(0, available.length - shownAvailable) + Math.max(0, comingSoon.length - shownComingSoon),
  };
}
