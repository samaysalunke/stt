export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', opts ?? {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '';
  const s = formatDate(start, { day: 'numeric', month: 'short' });
  if (!end) return s;
  const e = formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${s} – ${e}`;
}

export function sanitizeInput(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, 5000);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  return /^[+]?[\d\s\-()]{8,15}$/.test(phone.trim());
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDateIN(d: string | null | undefined): string {
  if (!d) return '—';
  // SQLite DATETIME values are space-separated ("2026-06-23 10:30:00"); slice the
  // YYYY-MM-DD prefix so both timestamps and date-only strings parse cleanly.
  const date = new Date(d.slice(0, 10) + 'T00:00:00');
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateFromUnix(unix: number | null | undefined): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTimeFromUnix(unix: number): string {
  return new Date(unix * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function formatINR(n: number): string {
  return '₹' + Math.round(n ?? 0).toLocaleString('en-IN');
}

export function regStatusStyle(status: string): string {
  if (status === 'confirmed') return 'background:#D1FAE5;color:#065F46;';
  if (status === 'rejected')  return 'background:#FEE2E2;color:#991B1B;';
  if (status === 'lead')      return 'background:#FEF9C3;color:#78350F;';
  if (status === 'wishlist')  return 'background:#E0E7FF;color:#3730A3;';
  return 'background:#FEF3C7;color:#92400E;';
}
