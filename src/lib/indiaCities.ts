import { normalizeIndiaState } from './indiaStates';

// Curated list of major Indian cities (metros, state capitals, and tier-2/3
// hubs) for the checkout city picker. Alphabetical. Not exhaustive — the picker
// has an "Other" option for anything not listed here.
export const INDIA_CITIES: string[] = [
  'Agartala', 'Agra', 'Ahmedabad', 'Ajmer', 'Alappuzha', 'Aligarh', 'Prayagraj',
  'Amravati', 'Amritsar', 'Chhatrapati Sambhajinagar', 'Bareilly', 'Belagavi', 'Bengaluru', 'Bhavnagar', 'Bhilai',
  'Bhopal', 'Bhubaneswar', 'Bikaner', 'Bilaspur', 'Chandigarh', 'Chennai', 'Coimbatore',
  'Cuttack', 'Dehradun', 'Delhi', 'Dhanbad', 'Dharamshala', 'Dispur', 'Durgapur', 'Erode',
  'Faridabad', 'Gandhinagar', 'Gangtok', 'Ghaziabad', 'Gorakhpur',
  'Greater Noida', 'Gurugram', 'Guwahati', 'Gwalior', 'Haridwar', 'Hubli-Dharwad',
  'Hyderabad', 'Imphal', 'Indore', 'Itanagar', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jammu',
  'Jamshedpur', 'Jodhpur', 'Kakinada', 'Kanpur', 'Kochi', 'Kohima', 'Kolhapur', 'Kolkata',
  'Kota', 'Kozhikode', 'Lucknow', 'Ludhiana', 'Madurai', 'Mangaluru', 'Meerut',
  'Mohali', 'Moradabad', 'Mumbai', 'Mysuru', 'Nagpur', 'Nashik', 'Navi Mumbai', 'Nellore',
  'Noida', 'Panaji', 'Patiala', 'Patna', 'Puducherry', 'Pune', 'Raipur', 'Rajkot', 'Ranchi',
  'Rishikesh', 'Rourkela', 'Saharanpur', 'Salem', 'Shillong', 'Shimla', 'Siliguri',
  'Solapur', 'Srinagar', 'Surat', 'Thane', 'Thiruvananthapuram', 'Thrissur', 'Tiruchirappalli',
  'Tirupati', 'Tirupur', 'Udaipur', 'Ujjain', 'Vadodara', 'Varanasi', 'Vijayawada',
  'Visakhapatnam', 'Warangal',
];

/**
 * Canonicalise a city as picked, typed or pasted into a CSV.
 *
 * The same reasoning as `normalizeIndiaState`, with one deliberate difference:
 * the state list is exhaustive, so an unrecognised state is refused, whereas
 * this list is not and the picker has an "Other" option. An unrecognised city
 * is therefore kept as typed rather than thrown away — "Ziro" is a real place
 * and no list will ever hold all of them.
 *
 * What it does catch is one city arriving under several names. Bangalore and
 * Bengaluru are the same city, and the column carried both; each geocodes to
 * its own cache entry, so the two read as different home points on a map and
 * the drawer shows one of them as "Other".
 *
 * Matching ignores case, surrounding space and internal punctuation, so
 * "navi mumbai", "Navi-Mumbai" and "NAVI MUMBAI" all land on 'Navi Mumbai'.
 */
const CITY_ALIASES: Record<string, string> = {
  // Former names, all still in everyday use. The canonical side is always the
  // current official name, which is what the list carries.
  bangalore: 'Bengaluru', bengalooru: 'Bengaluru',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  madras: 'Chennai',
  poona: 'Pune',
  baroda: 'Vadodara',
  gurgaon: 'Gurugram',
  mangalore: 'Mangaluru',
  mysore: 'Mysuru',
  trivandrum: 'Thiruvananthapuram',
  pondicherry: 'Puducherry',
  cochin: 'Kochi', ernakulam: 'Kochi',
  calicut: 'Kozhikode', kozhikodecalicut: 'Kozhikode',
  allahabad: 'Prayagraj', allahabadprayagraj: 'Prayagraj',
  belgaum: 'Belagavi',
  aurangabad: 'Chhatrapati Sambhajinagar', sambhajinagar: 'Chhatrapati Sambhajinagar',
  chatrapatisambhajinagar: 'Chhatrapati Sambhajinagar',
  trichy: 'Tiruchirappalli', tiruchirapalli: 'Tiruchirappalli',
  vizag: 'Visakhapatnam',
  hubli: 'Hubli-Dharwad', dharwad: 'Hubli-Dharwad', hubballi: 'Hubli-Dharwad',
  panjim: 'Panaji', goapanaji: 'Panaji',
  newdelhi: 'Delhi',
  // Spellings that actually reached the column.
  banglore: 'Bengaluru', blr: 'Bengaluru', benguluru: 'Bengaluru',
  hyderbad: 'Hyderabad', hyd: 'Hyderabad',
  mumbaii: 'Mumbai', mumbaib: 'Mumbai',
  lucknos: 'Lucknow',
  alleppey: 'Alappuzha',
  navimumabi: 'Navi Mumbai',
};

const squashCity = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

function lookup(text: string): string | null {
  const key = squashCity(text);
  if (!key) return null;
  return INDIA_CITIES.find((city) => squashCity(city) === key) ?? CITY_ALIASES[key] ?? null;
}

/**
 * "Jodhpur, Rajasthan", "Jodhpur (Rajasthan)", "Surat gujarat" — the city with
 * its state appended, which people type often enough that the column held the
 * same city under several of these.
 *
 * Returns the part before the state, or null when the tail is not an Indian
 * state: "Kathmandu, Nepal" and "Thane, Mumbai" are left whole.
 */
function withoutTrailingState(raw: string): string | null {
  const punctuated = raw.match(/^(.+?)\s*[,(/]\s*([^,()/]+?)\)?\s*$/);
  if (punctuated && normalizeIndiaState(punctuated[2])) return punctuated[1].trim();

  const words = raw.split(/\s+/);
  for (let i = words.length - 1; i >= 1; i--) {
    if (normalizeIndiaState(words.slice(i).join(' '))) return words.slice(0, i).join(' ');
  }
  return null;
}

export function normalizeIndiaCity(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!squashCity(raw)) return raw;

  const direct = lookup(raw);
  if (direct) return direct;

  // Only when what remains is a city we actually know. "why are these
  // mandatory 😭, delhi" ends in a state, and stripping it would leave the
  // complaint behind as the city — so a remainder we cannot place means the
  // value stays exactly as typed.
  const trimmed = withoutTrailingState(raw);
  if (trimmed) {
    const resolved = lookup(trimmed);
    if (resolved) return resolved;
  }

  // A real place we simply do not carry. Keep it as typed.
  return raw;
}

/** True when the value is already one of the listed spellings. */
export function isListedIndiaCity(value: unknown): boolean {
  return INDIA_CITIES.includes(String(value ?? '').trim());
}
