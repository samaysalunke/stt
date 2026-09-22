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
  /**
   * The DM-automation subscriber the link was sent to, when the flow appends
   * one. UTMs answer "which reel", this answers "which conversation" — it is
   * what joins a booking on the site back to the exact Instagram thread that
   * produced it. Purely a foreign key into the DM tool; we never derive a
   * channel from it.
   */
  subscriberId: string;
  capturedAt: string;
}

/** Params a DM flow may carry the subscriber in, in precedence order. The tool
 *  chooses the name when it builds the link, so accept both spellings rather
 *  than making the flow match ours exactly. */
const SUBSCRIBER_PARAMS = ['subscriber_id', 'sub_id'] as const;

const clean = (value: unknown) => String(value ?? '').trim().slice(0, MAX_VALUE);

const firstParam = (url: URL, names: readonly string[]) => {
  for (const name of names) {
    const value = clean(url.searchParams.get(name));
    if (value) return value;
  }
  return '';
};

export function attributionFromRequest(url: URL, request: Request): AttributionTouch {
  return {
    landingPage: clean(`${url.pathname}${url.search}`),
    referrer: clean(request.headers.get('referer')),
    utmSource: clean(url.searchParams.get('utm_source')),
    utmMedium: clean(url.searchParams.get('utm_medium')),
    utmCampaign: clean(url.searchParams.get('utm_campaign')),
    utmTerm: clean(url.searchParams.get('utm_term')),
    utmContent: clean(url.searchParams.get('utm_content')),
    subscriberId: firstParam(url, SUBSCRIBER_PARAMS),
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
  if (touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.subscriberId) return true;
  if (!touch.referrer) return false;
  try { return new URL(touch.referrer).origin !== siteOrigin; } catch { return false; }
}

function touchFromObject(parsed: any): AttributionTouch {
  return {
    landingPage: clean(parsed?.landingPage), referrer: clean(parsed?.referrer),
    utmSource: clean(parsed?.utmSource), utmMedium: clean(parsed?.utmMedium),
    utmCampaign: clean(parsed?.utmCampaign), utmTerm: clean(parsed?.utmTerm),
    utmContent: clean(parsed?.utmContent), subscriberId: clean(parsed?.subscriberId),
    capturedAt: clean(parsed?.capturedAt),
  };
}

function parseTouch(raw: string | undefined): AttributionTouch | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // `null` is a valid JSON document and a stored "no touch": it must read as
    // absent, not as a touch whose every field happens to be blank.
    if (!parsed || typeof parsed !== 'object') return null;
    return touchFromObject(parsed);
  } catch { return null; }
}

/**
 * Validate a first touch the PAGE hands back — the localStorage mirror the
 * capture beacon replays when the cookie is gone (see POST /api/attribution).
 *
 * Everything here is attacker-controlled, so nothing is taken on trust: fields
 * are clamped like a cookie's, the landing page is forced back onto our own
 * origin, and `capturedAt` must be a real, non-future timestamp — a replay that
 * could claim tomorrow's date would outrank every genuine touch in any
 * chronological report. A touch carrying no campaign signal and no referrer is
 * rejected too: it restores nothing the current visit doesn't already know, and
 * accepting it would let a page pin a visitor's first touch to a blank.
 */
export function restoreTouch(value: unknown, now: Date = new Date()): AttributionTouch | null {
  if (!value || typeof value !== 'object') return null;
  const touch = touchFromObject(value);

  const capturedAt = Date.parse(touch.capturedAt);
  if (!Number.isFinite(capturedAt) || capturedAt > now.getTime()) return null;

  const carriesSignal = touch.utmSource || touch.utmMedium || touch.utmCampaign
    || touch.utmTerm || touch.utmContent || touch.subscriberId || touch.referrer;
  if (!carriesSignal) return null;

  return {
    ...touch,
    landingPage: touch.landingPage ? sameOriginLandingPath(touch.landingPage) : '',
    capturedAt: new Date(capturedAt).toISOString(),
  };
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
