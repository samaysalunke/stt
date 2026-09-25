/**
 * The migration script cannot import the TypeScript library, so it rebuilds the
 * normaliser from the same source files. That copy has already drifted once:
 * the trailing-state rule landed in the library and the migration kept matching
 * without it, so a production dry run reported five rewrites where it should
 * have reported seventeen. Nothing failed — the migration simply did less than
 * it claimed.
 *
 * This is what makes the two provably the same.
 */
import { describe, expect, it } from 'vitest';
import { INDIA_CITIES, normalizeIndiaCity } from '../../src/lib/indiaCities';
import { buildCityNormalizer } from '../../scripts/lib/cityNormalizerFromSource.mjs';

const fromSource = buildCityNormalizer(process.cwd());

// Every shape this column has actually held in production, plus the cases the
// guards exist for.
const CORPUS = [
  'Bangalore', 'bangalore', 'Banglore', 'Blr', 'blr', 'Benguluru', 'Bengaluru',
  'Bombay', 'Mumbaii', 'Mumbaib', 'mumbai', 'Mumbai',
  'Hyderbad', 'Hyd', 'Calcutta', 'Madras', 'Poona', 'Baroda', 'Vizag',
  'Gurgaon', 'gurugram', 'New Delhi', 'New delhi', 'delhi', 'Delhi',
  'Belgaum', 'Belagavi', 'Belgaum karnataka',
  'Aurangabad', 'Chatrapati Sambhajinagar',
  'Allahabad', 'Prayagraj', 'Kozhikode', 'Kozhikode (Calicut)', 'Calicut',
  'Panjim', 'Panaji', 'Goa (Panaji)', 'Goa', 'Ponda Goa', 'Margao',
  'Cochin', 'Ernakulam', 'Alleppey', 'Alappuzha', 'Trivandrum', 'Mysore', 'Mangalore',
  'Jodhpur, Rajasthan', 'Jodhpur (Rajasthan)', 'Udaipur, Rajasthan', 'Jaipur, Rajasthan',
  'Amravati, Maharashtra', 'Amravati Maharashtra', 'Thane maharashtra', 'Thane, Mumbai',
  'Hubli, Karnataka', 'Hubli karnataka', 'Dharwad karnataka', 'Manipal, Karnataka',
  'Surat gujarat', 'Godhra Gujrat', 'Patiala , punjab', 'Bilaspur, chhattisgarh', 'Bilaspur cg',
  'Hosur, Tamil Nadu', 'Kannur, Kerala', 'Sidhi, Madhya Pradesh', 'Raichur, Karnataka',
  'Nagpur MH', 'Gulbarga (karnataka)', 'Rampur bsr, Dist shimla', 'Chhibramau, Kannauj',
  'Kalamassery/Ernakulam/Kerala', 'Ulhasnagar, Mumbai.', 'Sewagram,Wardha',
  'Kathmandu, Nepal', 'Rome, Italy', 'Edinburgh', 'Muscat', 'Kathmandu',
  'Chennai/Banglore', 'Dubai/ Thrissur', 'Mumbai/Leeds(uk)',
  'Let’s say hyderabad( I live in Dallas USA)', 'Ahmedabad (not a gujju)',
  'why are these mandatory 😭, delhi', 'nowhere', 'nowhere :)', 'Puns', 'Ind', 'India',
  '42342', '34234', 'Gujarat', 'Karnataka', 'Kerala', 'Punjab', 'Odisha', 'Tamilnadu', 'Haryana',
  'Ziro', 'Guntur', 'Satara', 'Mathura', 'Ayodhya', 'Baramati', 'Shirdi', 'Athani', 'Wardha',
  'navi mumbai', 'Navi-Mumbai', 'Airoli, Navi Mumabi', '', '   ', '😭', 'Ahmadnagar',
  ...INDIA_CITIES,
];

describe('the script normaliser matches the library', () => {
  it.each(CORPUS)('agrees on %j', (value) => {
    expect(fromSource(value)).toBe(normalizeIndiaCity(value));
  });
});

describe('the source parser', () => {
  it('refuses to build against a file it cannot parse', () => {
    // Without this the migration would normalise every city against an empty
    // list, which resolves nothing and would rewrite the column to itself at
    // best — and is exactly the kind of failure that looks like success.
    expect(() => buildCityNormalizer('/nonexistent')).toThrow();
  });
});
