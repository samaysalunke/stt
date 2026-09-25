import { describe, expect, it } from 'vitest';
import { billingProblems, billingSnapshot } from '../../src/lib/paymentLedger';

describe('payment ledger validation', () => {
  // State was required here until it turned out to be the reason invoicing
  // stalled: the Zoho org is not GST-registered, so there is no place-of-supply
  // to supply, and most bookings carry no state at all.
  it('does not require state for consumer documents', () => {
    const snapshot = billingSnapshot({ id: 1, full_name: 'A Traveller', email: 'a@example.com', country: 'India' });
    expect(billingProblems(snapshot)).toEqual([]);
  });

  it('still requires a billing name, which Zoho cannot create a contact without', () => {
    const snapshot = billingSnapshot({ id: 1, full_name: '   ', email: 'a@example.com', state: 'Maharashtra' });
    expect(billingProblems(snapshot)).toContain('billing name');
  });
});
