import { describe, expect, it } from 'vitest';
import { formatPolicyDate } from '../../src/lib/policyDates';

describe('formatPolicyDate', () => {
  it('formats admin ISO dates without timezone drift', () => {
    expect(formatPolicyDate('2026-08-27', 'August 2026')).toBe('27 August 2026');
  });
});
