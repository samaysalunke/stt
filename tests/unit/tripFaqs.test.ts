import { describe, expect, test } from 'vitest';
import { resolveTripFaqs } from '../../src/lib/faqs';
import { parseTripFaqs } from '../../src/lib/tripEditor';

const globals = [
  { slug: 'later-default', question: 'Later?', answer: 'Later answer', order: 20, defaultOnTripPages: true },
  { slug: 'early-default', question: 'Early?', answer: 'Early answer', order: 1, defaultOnTripPages: true },
  { slug: 'optional', question: 'Optional?', answer: 'Optional answer', order: 2, defaultOnTripPages: false },
];

describe('resolveTripFaqs', () => {
  test('applies exclusions and inclusions without changing global order', () => {
    const trip = { tripFaqOverrides: { exclude: ['early-default'], include: ['optional'] } };
    expect(resolveTripFaqs(trip, globals).map((faq) => faq.slug)).toEqual(['optional', 'later-default']);
  });

  test('ignores deleted global references and incomplete custom entries', () => {
    const trip = {
      tripFaqOverrides: { include: ['deleted-faq'], exclude: [] },
      tripFaqs: [{ question: 'Missing answer', answer: '' }],
    };
    expect(resolveTripFaqs(trip, globals)).toHaveLength(2);
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
