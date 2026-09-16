// Curated list of major Indian cities (metros, state capitals, and tier-2/3
// hubs) for the checkout city picker. Alphabetical. Not exhaustive — the picker
// has an "Other" option for anything not listed here.
export const INDIA_CITIES: string[] = [
  'Agartala', 'Agra', 'Ahmedabad', 'Ajmer', 'Alappuzha', 'Aligarh', 'Allahabad (Prayagraj)',
  'Amravati', 'Amritsar', 'Aurangabad', 'Bareilly', 'Belgaum', 'Bengaluru', 'Bhavnagar', 'Bhilai',
  'Bhopal', 'Bhubaneswar', 'Bikaner', 'Bilaspur', 'Chandigarh', 'Chennai', 'Coimbatore',
  'Cuttack', 'Dehradun', 'Delhi', 'Dhanbad', 'Dharamshala', 'Dispur', 'Durgapur', 'Erode',
  'Faridabad', 'Gandhinagar', 'Gangtok', 'Ghaziabad', 'Goa (Panaji)', 'Gorakhpur',
  'Greater Noida', 'Gurugram', 'Guwahati', 'Gwalior', 'Haridwar', 'Hubli-Dharwad',
  'Hyderabad', 'Imphal', 'Indore', 'Itanagar', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jammu',
  'Jamshedpur', 'Jodhpur', 'Kakinada', 'Kanpur', 'Kochi', 'Kohima', 'Kolhapur', 'Kolkata',
  'Kota', 'Kozhikode (Calicut)', 'Lucknow', 'Ludhiana', 'Madurai', 'Mangaluru', 'Meerut',
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
  // Renamed cities, both names still in everyday use.
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
  calicut: 'Kozhikode (Calicut)', kozhikode: 'Kozhikode (Calicut)',
  allahabad: 'Allahabad (Prayagraj)', prayagraj: 'Allahabad (Prayagraj)',
  trichy: 'Tiruchirappalli', tiruchirapalli: 'Tiruchirappalli',
  vizag: 'Visakhapatnam',
  hubli: 'Hubli-Dharwad', dharwad: 'Hubli-Dharwad', hubballi: 'Hubli-Dharwad',
  belagavi: 'Belgaum',
  panjim: 'Panaji',
  newdelhi: 'Delhi',
  // Spellings that actually reached the column.
  banglore: 'Bengaluru', blr: 'Bengaluru',
  hyderbad: 'Hyderabad', hyd: 'Hyderabad',
  mumbaii: 'Mumbai',
  lucknos: 'Lucknow',
  alleppey: 'Alappuzha',
  navimumabi: 'Navi Mumbai',
};

const squashCity = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

export function normalizeIndiaCity(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const key = squashCity(raw);
  if (!key) return raw;

  const exact = INDIA_CITIES.find((city) => squashCity(city) === key);
  if (exact) return exact;

  // Bare "Allahabad" against "Allahabad (Prayagraj)" and friends: the listed
  // name carries a parenthetical the typed one does not.
  const alias = CITY_ALIASES[key];
  if (alias) return alias;

  // Not on the list and not a name we know — a real place we simply do not
  // carry. Keep it as typed.
  return raw;
}

/** True when the value is already one of the listed spellings. */
export function isListedIndiaCity(value: unknown): boolean {
  return INDIA_CITIES.includes(String(value ?? '').trim());
}
