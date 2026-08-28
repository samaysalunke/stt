import { describe, expect, test } from 'vitest';
import { validTillLabel } from '../../src/components/DiscountCountdown';

describe('discount expiry label', () => {
  test('shows only the day and abbreviated month in Asia/Kolkata', () => {
    expect(validTillLabel('2026-08-28T18:30:00.000Z')).toBe('29 Aug');
  });

  test('uses the India date when UTC is still on the previous day', () => {
    expect(validTillLabel('2026-08-28T20:00:00.000Z')).toBe('29 Aug');
  });
});
