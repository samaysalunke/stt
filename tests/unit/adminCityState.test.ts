/**
 * The admin city and state controls, and the endpoint behind the customer edit.
 *
 * The city column is geocoded, and those coordinates place both the
 * leaderboard's km and the pins on public profile maps — `Tumahare dil mein`,
 * `nowhere` and `banglore` all reached it through admin's plain text input.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDIA_CITIES } from '../../src/lib/indiaCities';
import { normalizeIndiaState } from '../../src/lib/indiaStates';

const src = (rel: string) => readFileSync(path.join(process.cwd(), 'src', rel), 'utf-8');

describe('the admin city picker', () => {
  const component = src('components/admin/CitySelect.astro');

  it('offers the same list the public checkout does', () => {
    // One list, so a city spelled at checkout and a city typed by ops
    // geocode to the same point rather than to two neighbouring ones.
    expect(component).toContain("from '../../lib/indiaCities'");
    expect(src('components/BookingCheckout.tsx')).toContain("from '../lib/indiaCities'");
  });

  it('keeps an escape hatch, as checkout does', () => {
    // The list is not exhaustive; refusing everything off it would just push
    // ops into leaving the field blank.
    expect(component).toContain('__other__');
  });

  it('holds the value on the named input, so both read paths keep working', () => {
    // new.astro reads getElementById('city').value; customers.astro reads it
    // through FormData. Both see the same element.
    const input = component.slice(component.indexOf('<input'), component.indexOf('data-city-other') + 40);
    expect(input).toContain('id={id}');
    expect(input).toContain('name={name}');
  });
});

describe('the admin forms', () => {
  it('no longer takes a free-text city anywhere', () => {
    for (const file of ['pages/admin/registrations/new.astro', 'pages/admin/customers.astro']) {
      expect(src(file), file).not.toMatch(/<input[^>]*name="city"/);
      expect(src(file), file).not.toMatch(/<input[^>]*id="city"/);
      expect(src(file), file).toContain('CitySelect');
    }
  });

  it('offers state as a list on both forms', () => {
    expect(src('pages/admin/registrations/new.astro')).toContain('INDIA_STATES.map');
    // customers.astro had no state field at all before.
    expect(src('pages/admin/customers.astro')).toContain('INDIA_STATES.map');
  });

  it('selects the canonical option for a legacy spelling', () => {
    // Opening the form on "Orissa" and saving must not blank the state.
    expect(normalizeIndiaState('Orissa')).toBe('Odisha');
    expect(src('pages/admin/customers.astro')).toContain('normalizeIndiaState(c.state)');
  });
});

describe('the customer update endpoint', () => {
  const endpoint = src('pages/api/admin/customers/update.ts');

  it('refuses a state it cannot normalise rather than storing noise', () => {
    expect(endpoint).toContain('normalizeIndiaState');
    expect(endpoint).toMatch(/Unrecognised state/);
  });

  it('leaves state alone when the caller did not send it', () => {
    // The update applies to every registration for the email, so treating an
    // absent field as a clear would wipe a customer's whole history at once.
    expect(endpoint).toContain('body.state !== undefined');
    expect(endpoint).toContain('stateSent');
  });
});

describe('the city list itself', () => {
  it('has no duplicates and no untrimmed entries', () => {
    expect(new Set(INDIA_CITIES).size).toBe(INDIA_CITIES.length);
    expect(INDIA_CITIES.filter((c) => c !== c.trim())).toEqual([]);
  });

  it('carries the cities travellers have actually booked from', () => {
    for (const city of ['Bengaluru', 'Mumbai', 'Hyderabad', 'Pune', 'Chennai']) {
      expect(INDIA_CITIES).toContain(city);
    }
  });
});
