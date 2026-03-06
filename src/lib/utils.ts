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
