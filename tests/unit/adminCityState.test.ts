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

const src = (rel: string) => readFileSync(path.join(process.cwd(), 'src', rel), 'utf-8');

describe('an admin city edit refreshes the leaderboard', () => {
  // Found the hard way: a bad city was corrected in the drawer and the
  // traveller stayed on 0 km, because nothing on these paths recalculated. The
  // city is the home point every distance is measured from.
  it.each([
    ['pages/api/admin/customers/update.ts', 'the customer drawer'],
    ['pages/api/admin/registrations/fields.ts', 'the registration field patch'],
  ])('%s recalculates after a city change', (file) => {
    const endpoint = src(file);
    expect(endpoint).toContain('recalculateUserLeaderboard');
    // Guarded on an actual change, so renaming a customer does not queue a
    // geocoding pass for every one of their registrations.
    expect(endpoint).toMatch(/if \([^)]*city[^)]*!==/);
  });
});
