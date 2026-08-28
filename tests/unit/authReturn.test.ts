import { describe, expect, it } from 'vitest';
import { safeProfileReturn } from '../../src/lib/authReturn';

describe('safeProfileReturn', () => {
  it('retains supported profile navigation', () => expect(safeProfileReturn('/profile?tab=trips&pastPage=3')).toBe('/profile?tab=trips&pastPage=3'));
  it('drops unsupported parameters', () => expect(safeProfileReturn('/profile?tab=settings&token=secret')).toBe('/profile?tab=settings'));
  it('rejects off-site and non-profile redirects', () => {
    expect(safeProfileReturn('//evil.example/profile')).toBe('/profile');
    expect(safeProfileReturn('/admin')).toBe('/profile');
  });
});
