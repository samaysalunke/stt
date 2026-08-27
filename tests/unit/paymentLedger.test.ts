import { describe, expect, it } from 'vitest';
import { billingProblems, billingSnapshot, sanitizePaymentMethod, validReceivedAt } from '../../src/lib/paymentLedger';

describe('payment ledger validation', () => {
  it('accepts supported methods and rejects arbitrary provider values', () => {
    expect(sanitizePaymentMethod(' UPI ')).toBe('upi');
    expect(sanitizePaymentMethod('crypto')).toBeNull();
  });

  it('rejects future received dates', () => {
    expect(validReceivedAt('2099-01-01')).toBe(false);
    expect(validReceivedAt('2025-01-01')).toBe(true);
  });

  it('requires state for consumer documents', () => {
    const snapshot = billingSnapshot({ id: 1, full_name: 'A Traveller', email: 'a@example.com', country: 'India' });
    expect(billingProblems(snapshot)).toContain('state');
  });

  it('builds a consumer document snapshot from traveller details', () => {
    const snapshot = billingSnapshot({
      id: 2, full_name: 'A Traveller', email: 'traveller@example.com',
      city: 'Mumbai', state: 'Maharashtra',
    });
    expect(billingProblems(snapshot)).toEqual([]);
    expect(snapshot.customerName).toBe('A Traveller');
    expect(snapshot.state).toBe('Maharashtra');
  });
});
