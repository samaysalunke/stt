/**
 * Every path that records a state — public checkout, admin create, CSV import,
 * the admin field patch — routes through normalizeIndiaState, so the column
 * holds one spelling per state instead of whatever each caller sent.
 */
import { describe, expect, it } from 'vitest';
import { INDIA_STATES, normalizeIndiaState } from '../../src/lib/indiaStates';

describe('normalizeIndiaState', () => {
  it('covers all 28 states and 8 union territories', () => {
    expect(INDIA_STATES).toHaveLength(36);
    expect(new Set(INDIA_STATES).size).toBe(36);
  });

  it('accepts every canonical value unchanged', () => {
    for (const state of INDIA_STATES) expect(normalizeIndiaState(state)).toBe(state);
  });

  it('ignores case, surrounding space and internal punctuation', () => {
    expect(normalizeIndiaState('maharashtra')).toBe('Maharashtra');
    expect(normalizeIndiaState('  Delhi ')).toBe('Delhi');
    expect(normalizeIndiaState('TAMIL NADU')).toBe('Tamil Nadu');
    expect(normalizeIndiaState('Tamilnadu')).toBe('Tamil Nadu');
    expect(normalizeIndiaState('West  Bengal')).toBe('West Bengal');
    expect(normalizeIndiaState('Jammu & Kashmir')).toBe('Jammu and Kashmir');
  });

  it('maps the former names that still turn up in exports', () => {
    expect(normalizeIndiaState('Orissa')).toBe('Odisha');
    expect(normalizeIndiaState('Pondicherry')).toBe('Puducherry');
    expect(normalizeIndiaState('Uttaranchal')).toBe('Uttarakhand');
  });

  // Unrecognised input is stored as "no state" rather than as noise — the
  // column fed the Zoho billing address and used to accept arbitrary text.
  it('rejects anything it cannot place', () => {
    for (const value of ['Narnia', 'n/a', '-', '', '   ', null, undefined, 42, {}]) {
      expect(normalizeIndiaState(value)).toBeNull();
    }
  });
});
