import { describe, expect, test } from 'vitest';
import { resolveTripFaqs } from '../../src/lib/faqs';
import { parseTripFaqs } from '../../src/lib/tripEditor';

const globals = [
  { slug: 'later-default', question: 'Later?', answer: 'Later answer', order: 20, defaultOnTripPages: true },
  { slug: 'early-default', question: 'Early?', answer: 'Early answer', order: 1, defaultOnTripPages: true },
  { slug: 'optional', question: 'Optional?', answer: 'Optional answer', order: 2, defaultOnTripPages: false },
];

describe('resolveTripFaqs', () => {
  test('legacy trips inherit live defaults in global order', () => {
    expect(resolveTripFaqs({}, globals).map((faq) => faq.slug)).toEqual(['early-default', 'later-default']);
  });

  test('applies exclusions and inclusions without changing global order', () => {
    const trip = { tripFaqOverrides: { exclude: ['early-default'], include: ['optional'] } };
    expect(resolveTripFaqs(trip, globals).map((faq) => faq.slug)).toEqual(['optional', 'later-default']);
  });

  test('appends trip-only FAQs in saved order', () => {
    const trip = { tripFaqs: [
      { question: 'Custom one?', answer: 'One.' },
      { question: 'Custom two?', answer: 'Two.' },
    ] };
    const resolved = resolveTripFaqs(trip, globals);
    expect(resolved.slice(-2)).toEqual([
      { question: 'Custom one?', answer: 'One.', source: 'trip' },
      { question: 'Custom two?', answer: 'Two.', source: 'trip' },
    ]);
  });

  test('ignores deleted global references and incomplete custom entries', () => {
    const trip = {
      tripFaqOverrides: { include: ['deleted-faq'], exclude: [] },
      tripFaqs: [{ question: 'Missing answer', answer: '' }],
    };
    expect(resolveTripFaqs(trip, globals)).toHaveLength(2);
  });

  test('reflects changes to live global defaults', () => {
    const changed = globals.map((faq) => faq.slug === 'optional' ? { ...faq, defaultOnTripPages: true } : faq);
    expect(resolveTripFaqs({}, changed).map((faq) => faq.slug)).toEqual(['early-default', 'optional', 'later-default']);
  });
});

describe('parseTripFaqs', () => {
  test('sanitizes, deduplicates, and round-trips valid editor data', () => {
    const parsed = parseTripFaqs(
      JSON.stringify({ include: [' optional ', 'optional', '../bad'], exclude: ['early-default', 'optional'] }),
      JSON.stringify([{ question: ' Custom? ', answer: ' Yes. ' }, { question: '', answer: 'skip' }]),
    );
    expect(parsed).toEqual({
      tripFaqOverrides: { include: ['optional'], exclude: ['early-default'] },
      tripFaqs: [{ question: 'Custom?', answer: 'Yes.' }],
    });
  });

  test('fails closed to empty values for malformed JSON', () => {
    expect(parseTripFaqs('nope', '{')).toEqual({
      tripFaqOverrides: { include: [], exclude: [] },
      tripFaqs: [],
    });
  });
});
