const FIRST_TOUCH_COOKIE = 'stt_first_touch';
const LATEST_TOUCH_COOKIE = 'stt_latest_touch';
const MAX_VALUE = 500;

export interface AttributionTouch {
  landingPage: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  capturedAt: string;
}

const clean = (value: unknown) => String(value ?? '').trim().slice(0, MAX_VALUE);

export function attributionFromRequest(url: URL, request: Request): AttributionTouch {
  return {
    landingPage: clean(`${url.pathname}${url.search}`),
    referrer: clean(request.headers.get('referer')),
    utmSource: clean(url.searchParams.get('utm_source')),
    utmMedium: clean(url.searchParams.get('utm_medium')),
    utmCampaign: clean(url.searchParams.get('utm_campaign')),
    utmTerm: clean(url.searchParams.get('utm_term')),
    utmContent: clean(url.searchParams.get('utm_content')),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Force a client-supplied landing path to be a same-origin path.
 *
 * Used by POST /api/attribution, where the landing page arrives from the page
 * instead of from the request URL. Resolving against our origin is not enough
 * on its own: an absolute ("https://elsewhere/x") or protocol-relative
 * ("//elsewhere/x") value wins over the base and would put an off-site URL in
 * the stored touch, which the admin attribution views then display. Anything
 * that is not plainly a path collapses to "/". Backslashes are slash-equivalent
 * to the URL parser, so they collapse too.
 */
export function sameOriginLandingPath(value: string): string {
  if (!value.startsWith('/')) return '/';
  const collapsed = `/${value.replace(/^[/\\]+/, '')}`;
  return collapsed.startsWith('//') ? '/' : collapsed;
}

export function hasCampaignTouch(touch: AttributionTouch, siteOrigin: string): boolean {
  if (touch.utmSource || touch.utmMedium || touch.utmCampaign) return true;
  if (!touch.referrer) return false;
  try { return new URL(touch.referrer).origin !== siteOrigin; } catch { return false; }
}

function parseTouch(raw: string | undefined): AttributionTouch | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      landingPage: clean(parsed.landingPage), referrer: clean(parsed.referrer),
      utmSource: clean(parsed.utmSource), utmMedium: clean(parsed.utmMedium),
      utmCampaign: clean(parsed.utmCampaign), utmTerm: clean(parsed.utmTerm),
      utmContent: clean(parsed.utmContent), capturedAt: clean(parsed.capturedAt),
    };
  } catch { return null; }
}

export function readAttribution(cookies: { get(name: string): { value: string } | undefined }) {
  return {
    firstTouch: parseTouch(cookies.get(FIRST_TOUCH_COOKIE)?.value),
    latestTouch: parseTouch(cookies.get(LATEST_TOUCH_COOKIE)?.value),
  };
}

export function attributionSource(touch: AttributionTouch | null): { source: string; detail: string | null } {
  if (!touch) return { source: 'direct', detail: null };
  let source = touch.utmSource;
  if (!source && touch.referrer) {
    try { source = new URL(touch.referrer).hostname.replace(/^www\./, ''); } catch { /* direct */ }
  }
  const detail = [touch.utmMedium, touch.utmCampaign].filter(Boolean).join(' / ') || null;
  return { source: source || 'direct', detail };
}

export const attributionCookieNames = {
  first: FIRST_TOUCH_COOKIE,
  latest: LATEST_TOUCH_COOKIE,
};
