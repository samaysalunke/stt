import { describe, expect, it } from 'vitest';
import {
  attributionCookieNames,
  attributionFromRequest,
  attributionSource,
  hasCampaignTouch,
  readAttribution,
  sameOriginLandingPath,
} from '../../src/lib/attribution';

describe('conversion attribution', () => {
  it('captures UTM parameters and the complete landing path server-side', () => {
    const url = new URL('https://www.seekthethrill.in/trips/ladakh/?utm_source=instagram&utm_medium=paid-social&utm_campaign=summer');
    const request = new Request(url, { headers: { referer: 'https://instagram.com/' } });
    const touch = attributionFromRequest(url, request);

    expect(touch).toMatchObject({
      landingPage: '/trips/ladakh/?utm_source=instagram&utm_medium=paid-social&utm_campaign=summer',
      referrer: 'https://instagram.com/',
      utmSource: 'instagram',
      utmMedium: 'paid-social',
      utmCampaign: 'summer',
    });
    expect(attributionSource(touch)).toEqual({ source: 'instagram', detail: 'paid-social / summer' });
  });

  it('recognizes external referrals but ignores internal navigation as a new touch', () => {
    const external = attributionFromRequest(new URL('https://www.seekthethrill.in/trips/'), new Request('https://www.seekthethrill.in/trips/', {
      headers: { referer: 'https://www.google.com/search?q=seek+the+thrill' },
    }));
    const internal = { ...external, referrer: 'https://www.seekthethrill.in/' };
    expect(hasCampaignTouch(external, 'https://www.seekthethrill.in')).toBe(true);
    expect(hasCampaignTouch(internal, 'https://www.seekthethrill.in')).toBe(false);
    expect(attributionSource(external).source).toBe('google.com');
  });

  // The landing page now arrives from the client beacon instead of the request
  // URL, so it has to be pinned to our own origin before it is stored.
  it('keeps a client-supplied landing page on our own origin', () => {
    const base = 'https://www.seekthethrill.in';

    expect(sameOriginLandingPath('/trips/ladakh/')).toBe('/trips/ladakh/');
    expect(sameOriginLandingPath('https://evil.example/x')).toBe('/');
    expect(sameOriginLandingPath('trips/')).toBe('/');
    expect(sameOriginLandingPath('')).toBe('/');
    // Protocol-relative and backslash forms must not survive as a host.
    expect(sameOriginLandingPath('//evil.example/x')).toBe('/evil.example/x');
    expect(sameOriginLandingPath('/\\evil.example/x')).toBe('/evil.example/x');

    for (const hostile of ['https://evil.example/x', '//evil.example/x', '/\\evil.example/x']) {
      expect(new URL(sameOriginLandingPath(hostile), base).origin).toBe(base);
    }
  });

  it('fails closed when attribution cookies are malformed', () => {
    const cookies = { get: (name: string) => ({ value: name === attributionCookieNames.first ? '{bad' : 'null' }) };
    expect(readAttribution(cookies)).toEqual({ firstTouch: null, latestTouch: null });
  });
});
