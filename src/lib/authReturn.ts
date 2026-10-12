const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * Where an OAuth sign-in may land afterwards. An allow-list, not a same-origin
 * check: the profile surface, the trips listing (optionally with the one trip
 * the visitor tapped "save" on, which the page then saves), and the home page.
 * Any other value, and any other parameter, falls back to /profile.
 */
export function safeProfileReturn(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/profile';
  try {
    const url = new URL(value, 'https://return.invalid');
    if (url.origin !== 'https://return.invalid') return '/profile';
    if (url.pathname === '/') return '/';
    if (url.pathname === '/trips/') {
      const save = url.searchParams.get('save');
      return save && SLUG_RE.test(save) ? `/trips/?save=${save}` : '/trips/';
    }
    if (url.pathname !== '/profile') return '/profile';
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
