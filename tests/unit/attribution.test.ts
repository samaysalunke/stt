import { describe, expect, it } from 'vitest';
import {
  attributionCookieNames,
  attributionFromRequest,
  attributionSource,
  hasCampaignTouch,
  readAttribution,
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

  it('fails closed when attribution cookies are malformed', () => {
    const cookies = { get: (name: string) => ({ value: name === attributionCookieNames.first ? '{bad' : 'null' }) };
    expect(readAttribution(cookies)).toEqual({ firstTouch: null, latestTouch: null });
  });
});
