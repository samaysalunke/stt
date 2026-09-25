import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import DiscountCountdown, { useDiscountActive, validTillLabel } from '../../src/components/DiscountCountdown';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('discount expiry label', () => {
  test('shows only the day and abbreviated month in Asia/Kolkata', () => {
    expect(validTillLabel('2026-08-28T18:30:00.000Z')).toBe('29 Aug');
  });

  test('renders identical initial markup on either side of the expiry time', () => {
    const endsAt = '2026-08-28T18:30:00.000Z';
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-28T18:29:59.000Z').getTime());
    const serverMarkup = renderToString(createElement(DiscountCountdown, { endsAt, reloadOnExpire: true }));

    vi.mocked(Date.now).mockReturnValue(new Date('2026-08-28T18:30:01.000Z').getTime());
    const hydrationMarkup = renderToString(createElement(DiscountCountdown, { endsAt, reloadOnExpire: true }));

    expect(hydrationMarkup).toBe(serverMarkup);
    expect(serverMarkup).toContain('29 Aug');
  });
});

describe('discount active hydration state', () => {
  function ActiveProbe({ initiallyActive }: { initiallyActive: boolean }) {
    const active = useDiscountActive('2026-08-28T18:30:00.000Z', initiallyActive);
    return createElement('span', null, active ? 'discounted' : 'standard');
  }

  test('keeps an active server snapshot for the initial client render', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-28T18:30:01.000Z').getTime());
    expect(renderToString(createElement(ActiveProbe, { initiallyActive: true }))).toContain('discounted');
  });

  test('keeps an inactive server snapshot for the initial client render', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-28T18:29:59.000Z').getTime());
    expect(renderToString(createElement(ActiveProbe, { initiallyActive: false }))).toContain('standard');
  });
});
