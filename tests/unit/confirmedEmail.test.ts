import { describe, expect, it } from 'vitest';
import { confirmedEmailPayload } from '../../src/lib/zohoBooks';

const reg = { full_name: 'A Traveller', email: 'a@example.com', trip_name: 'The Eastern Frontier', trip_date: '2 Oct 2026 – 8 Oct 2026', total_amount: 33000 };

describe('confirmedEmailPayload', () => {
  it('marks a fully-covered ledger as paid in full', () => {
    const p = confirmedEmailPayload(reg, { totalAmount: 33000 }, 33000);
    expect(p.kind).toBe('full');
    expect(p.amountPaid).toBe(33000);
    expect(p.balanceDue).toBe(0);
  });

  it('reports a partial payment as an advance with the real balance', () => {
    const p = confirmedEmailPayload(reg, { totalAmount: 33000 }, 10000);
    expect(p.kind).toBe('advance');
    expect(p.amountPaid).toBe(10000);
    expect(p.balanceDue).toBe(23000);
  });

  it('clamps an over-recorded amount to the invoice total', () => {
    const p = confirmedEmailPayload(reg, { totalAmount: 33000 }, 50000);
    expect(p.amountPaid).toBe(33000);
    expect(p.kind).toBe('full');
  });

  it('never emits a negative or NaN amount', () => {
    expect(confirmedEmailPayload(reg, { totalAmount: 33000 }, -5).amountPaid).toBe(0);
    expect(confirmedEmailPayload(reg, { totalAmount: 33000 }, NaN as unknown as number).amountPaid).toBe(0);
  });

  it('falls back to the snapshot total when the reg row has none', () => {
    const p = confirmedEmailPayload({ ...reg, total_amount: null }, { totalAmount: 33000 }, 33000);
    expect(p.totalAmount).toBe(33000);
    expect(p.kind).toBe('full');
  });

  it('attaches the invoice PDF when supplied', () => {
    const p = confirmedEmailPayload(reg, { totalAmount: 33000 }, 33000, { filename: 'INV-1.pdf', content: 'x', contentType: 'application/pdf' });
    expect(p.attachment?.filename).toBe('INV-1.pdf');
  });
});
