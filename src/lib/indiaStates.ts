// All 28 states + 8 union territories of India, alphabetical, as one flat list
// for the checkout state picker. The traveller doesn't need the state/UT
// distinction, so they're merged.
export const INDIA_STATES: string[] = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
  'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala',
  'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

/**
 * Canonicalise a state as typed, keyed or pasted into a CSV.
 *
 * Every path that records a state routes through here so the column holds one
 * spelling of each state rather than whatever each caller happened to send —
 * the admin field patch used to take arbitrary free text, and a CSV column is
 * whoever exported it. Returns null for anything unrecognised, so a bad value
 * is stored as "no state" instead of as noise.
 *
 * Matching ignores case, surrounding space, and internal punctuation, which
 * covers the spellings that actually turn up: "delhi", "Tamilnadu",
 * "Jammu & Kashmir", "Orissa".
 */
const STATE_ALIASES: Record<string, string> = {
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  uttaranchal: 'Uttarakhand',
  newdelhi: 'Delhi',
  nctofdelhi: 'Delhi',
  jammukashmir: 'Jammu and Kashmir',
  andaman: 'Andaman and Nicobar Islands',
  dadranagarhaveli: 'Dadra and Nagar Haveli and Daman and Diu',
  damananddiu: 'Dadra and Nagar Haveli and Daman and Diu',
};

const squash = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

export function normalizeIndiaState(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const key = squash(raw);
  if (!key) return null;
  const exact = INDIA_STATES.find((state) => squash(state) === key);
  if (exact) return exact;
  // "and" vs "&" is already handled by squash; this catches the rest.
  return STATE_ALIASES[key] ?? null;
}
