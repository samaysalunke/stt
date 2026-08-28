/** OAuth redirects may only return to the authenticated profile surface. */
export function safeProfileReturn(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/profile';
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid' || url.pathname !== '/profile') return '/profile';
    const clean = new URLSearchParams();
    const tab = url.searchParams.get('tab');
    if (tab && ['overview', 'trips', 'settings'].includes(tab)) clean.set('tab', tab);
    const pastPage = url.searchParams.get('pastPage');
    if (pastPage && /^\d{1,6}$/.test(pastPage)) clean.set('pastPage', pastPage);
    return `/profile${clean.size ? `?${clean}` : ''}`;
  } catch {
    return '/profile';
  }
}
