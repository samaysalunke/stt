/**
 * The city column is geocoded, and those coordinates set every km on the
 * leaderboard and the pins on public profile maps. Bangalore and Bengaluru are
 * the same city but were arriving as both, each geocoding to its own cache
 * entry — two home points for one traveller's neighbours.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INDIA_CITIES, isListedIndiaCity, normalizeIndiaCity } from '../../src/lib/indiaCities';

const src = (rel: string) => readFileSync(path.join(process.cwd(), 'src', rel), 'utf-8');

describe('normalizeIndiaCity', () => {
  it.each([
    ['Bangalore', 'Bengaluru'], ['bangalore', 'Bengaluru'], ['  BANGALORE  ', 'Bengaluru'],
    ['Bombay', 'Mumbai'], ['Calcutta', 'Kolkata'], ['Madras', 'Chennai'],
    ['Gurgaon', 'Gurugram'], ['Baroda', 'Vadodara'], ['Trivandrum', 'Thiruvananthapuram'],
    ['Mysore', 'Mysuru'], ['Cochin', 'Kochi'], ['Vizag', 'Visakhapatnam'],
  ])('resolves the alternate name %p to %p', (input, expected) => {
    expect(normalizeIndiaCity(input)).toBe(expected);
  });

  it.each([
    ['Banglore', 'Bengaluru'], ['blr', 'Bengaluru'], ['Hyderbad', 'Hyderabad'],
    ['Mumbaii', 'Mumbai'], ['Lucknos', 'Lucknow'], ['Alleppey', 'Alappuzha'], ['Benguluru', 'Bengaluru'], ['Mumbaib', 'Mumbai'],
  ])('resolves the spelling %p, which the column actually held, to %p', (input, expected) => {
    expect(normalizeIndiaCity(input)).toBe(expected);
  });

  it('ignores case, space and punctuation', () => {
    for (const v of ['navi mumbai', 'Navi-Mumbai', 'NAVI  MUMBAI', ' navi mumbai ']) {
      expect(normalizeIndiaCity(v)).toBe('Navi Mumbai');
    }
  });

  it('always lands on the current official name', () => {
    // The list mixed directions before: Bengaluru and Mumbai were the modern
    // names, but Belgaum and Aurangabad were the old ones, and two entries
    // carried a parenthetical. One rule now — canonical is what the place is
    // called today, and every former name is an alias onto it.
    expect(normalizeIndiaCity('Allahabad')).toBe('Prayagraj');
    expect(normalizeIndiaCity('Prayagraj')).toBe('Prayagraj');
    expect(normalizeIndiaCity('Calicut')).toBe('Kozhikode');
    expect(normalizeIndiaCity('Belgaum')).toBe('Belagavi');
    expect(normalizeIndiaCity('Belagavi')).toBe('Belagavi');
    expect(normalizeIndiaCity('Aurangabad')).toBe('Chhatrapati Sambhajinagar');
  });

  it('carries no place under two list entries', () => {
    // 'Goa (Panaji)' and 'Panaji' were both listed, so the picker offered the
    // same city twice and they geocoded separately.
    expect(INDIA_CITIES.filter((c) => /panaji/i.test(c))).toEqual(['Panaji']);
  });

  describe('a city with its state appended', () => {
    it.each([
      ['Jodhpur, Rajasthan', 'Jodhpur'],
      ['Jodhpur (Rajasthan)', 'Jodhpur'],
      ['Surat gujarat', 'Surat'],
      ['Amravati, Maharashtra', 'Amravati'],
      ['Amravati Maharashtra', 'Amravati'],
      ['Patiala , punjab', 'Patiala'],
      ['Bilaspur, chhattisgarh', 'Bilaspur'],
      ['Thane maharashtra', 'Thane'],
      ['Hubli, Karnataka', 'Hubli-Dharwad'],
      ['Dharwad karnataka', 'Hubli-Dharwad'],
    ])('resolves %p to %p', (input, expected) => {
      expect(normalizeIndiaCity(input)).toBe(expected);
    });

    it('leaves the value whole when the remainder is not a city we know', () => {
      // The dangerous case: this ends in a state, and stripping it blindly
      // would store the complaint as the city.
      expect(normalizeIndiaCity('why are these mandatory 😭, delhi'))
        .toBe('why are these mandatory 😭, delhi');
      expect(normalizeIndiaCity('Rampur bsr, Dist shimla')).toBe('Rampur bsr, Dist shimla');
    });

    it('leaves a trailing word that is not an Indian state', () => {
      expect(normalizeIndiaCity('Kathmandu, Nepal')).toBe('Kathmandu, Nepal');
      expect(normalizeIndiaCity('Rome, Italy')).toBe('Rome, Italy');
      // Mumbai is a city, not a state, so this is not the "city, state" shape.
      expect(normalizeIndiaCity('Thane, Mumbai')).toBe('Thane, Mumbai');
    });

    it('never picks a side of an ambiguous answer', () => {
      expect(normalizeIndiaCity('Chennai/Banglore')).toBe('Chennai/Banglore');
      expect(normalizeIndiaCity('Dubai/ Thrissur')).toBe('Dubai/ Thrissur');
    });

    it('leaves a bare state alone rather than guessing its capital', () => {
      for (const v of ['Goa', 'Kerala', 'Karnataka', 'Punjab']) {
        expect(normalizeIndiaCity(v)).toBe(v);
      }
    });
  });

  it('keeps a real place that is simply not on the list', () => {
    // The difference from state, which is exhaustive and refuses the unknown.
    // No list holds every Indian town, and the picker has an "Other" option.
    expect(normalizeIndiaCity('Ziro')).toBe('Ziro');
    expect(normalizeIndiaCity('Sewagram, Wardha')).toBe('Sewagram, Wardha');
  });

  it('returns null only for nothing at all', () => {
    expect(normalizeIndiaCity('')).toBeNull();
    expect(normalizeIndiaCity('   ')).toBeNull();
    expect(normalizeIndiaCity(null)).toBeNull();
    expect(normalizeIndiaCity(undefined)).toBeNull();
  });

  it('is idempotent — normalising a normalised value changes nothing', () => {
    for (const city of INDIA_CITIES) expect(normalizeIndiaCity(city)).toBe(city);
  });
});

describe('the alias table', () => {
  it('only ever resolves to a listed city', () => {
    // An alias pointing off the list would hand the picker a value it cannot
    // show, so the drawer would render a known city as "Other".
    const file = src('lib/indiaCities.ts');
    const block = file.slice(file.indexOf('CITY_ALIASES'), file.indexOf('const squashCity'));
    const targets = [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(20);
    expect([...new Set(targets)].filter((t) => !INDIA_CITIES.includes(t))).toEqual([]);
  });

  it('never aliases a name that is already listed', () => {
    const file = src('lib/indiaCities.ts');
    const block = file.slice(file.indexOf('CITY_ALIASES'), file.indexOf('const squashCity'));
    const keys = [...block.matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
    const squash = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');
    const listed = new Set(INDIA_CITIES.map(squash));
    // Shadowing a listed spelling would be dead config at best and a silent
    // rename at worst.
    expect(keys.filter((k) => listed.has(k))).toEqual([]);
  });
});

describe('isListedIndiaCity', () => {
  it('reports whether the picker can show the value without "Other"', () => {
    expect(isListedIndiaCity('Bengaluru')).toBe(true);
    expect(isListedIndiaCity('Bangalore')).toBe(false);
    expect(isListedIndiaCity('Ziro')).toBe(false);
  });
});

describe('every path that writes a city normalises it', () => {
  it.each([
    ['pages/api/register.ts', 'the public checkout'],
    ['lib/registrationWrite.ts', 'admin create and the CSV importer'],
    ['pages/api/admin/customers/update.ts', 'the customer drawer'],
    ['pages/api/admin/registrations/fields.ts', 'the registration field patch'],
  ])('%s', (file) => {
    expect(src(file)).toContain('normalizeIndiaCity');
  });
});
