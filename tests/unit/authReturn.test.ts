import { describe, expect, it } from 'vitest';
import { safeProfileReturn } from '../../src/lib/authReturn';

describe('safeProfileReturn', () => {
  it('retains supported profile navigation', () => expect(safeProfileReturn('/profile?tab=trips&pastPage=3')).toBe('/profile?tab=trips&pastPage=3'));
  it('drops unsupported parameters', () => expect(safeProfileReturn('/profile?tab=settings&token=secret')).toBe('/profile?tab=settings'));
  it('rejects off-site and non-profile redirects', () => {
    expect(safeProfileReturn('//evil.example/profile')).toBe('/profile');
    expect(safeProfileReturn('/admin')).toBe('/profile');
  });
  it('returns to the trips listing, carrying only a well-formed trip to save', () => {
    expect(safeProfileReturn('/trips/?save=spiti-valley')).toBe('/trips/?save=spiti-valley');
    expect(safeProfileReturn('/trips/?save=spiti&x=1')).toBe('/trips/?save=spiti');
    expect(safeProfileReturn('/trips/?save=../admin')).toBe('/trips/');
    expect(safeProfileReturn('/trips/?save=%3Cscript%3E')).toBe('/trips/');
    expect(safeProfileReturn('/trips/spiti/')).toBe('/profile');
  });
  it('returns to the home page without parameters', () => {
    expect(safeProfileReturn('/?utm=x')).toBe('/');
  });
  it('still refuses anything off-site', () => {
    expect(safeProfileReturn('https://evil.example/trips/')).toBe('/profile');
    expect(safeProfileReturn('/\\evil.example/trips/')).toBe('/profile');
    expect(safeProfileReturn('//evil.example/')).toBe('/profile');
  });
});
