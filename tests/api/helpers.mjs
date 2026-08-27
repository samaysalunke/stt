export const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4323';

export async function apiPost(path, body, { headers = {}, redirect = 'follow' } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

export async function apiGet(path, { redirect = 'manual', cookie = null } = {}) {
  const headers = cookie ? { cookie } : {};
  const res = await fetch(`${BASE}${path}`, { redirect, headers });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : null;
  return { status: res.status, data, headers: res.headers, url: res.url };
}

// Returns { cookie, setCookie, location } after a successful login
export async function adminLogin(password = 'changeme') {
  const fd = new FormData();
  fd.append('password', password);
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    body: fd,
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/admin_token=[^;]+/);
  return {
    cookie: match?.[0] ?? '',
    setCookie,
    location: res.headers.get('location') ?? '',
    status: res.status,
  };
}

// Canonical registration payload using a real trip slug
export const VALID_REG = {
  // Stable QA fixture trip with a far-future, bookable departure (src/content/trips/qa-test-bookable.yaml).
  // Bookings are now tied to a departure, so a valid batchId is required.
  tripSlug:       'qa-test-bookable',
  tripName:       'QA Test — Bookable Trip',
  batchId:        'qa-bookable-2099',
  tripDate:       '1 Jan 2099 – 3 Jan 2099',
  tripDuration:   '3 Days',
  fullName:       'QA Test User',
  email:          'qa-test@example.invalid',
  phone:          '9876543210',
  age:            '25',
  gender:         'prefer-not-to-say',
  city:           'Mumbai',
  state:          'Maharashtra',
  instagram:      '@qa_test_user',
  emergencyName:  'QA Emergency Contact',
  emergencyPhone: '9123456789',
  whyJoin:        'Automated QA test submission — safe to ignore.',
  // Consent is required server-side for a valid booking.
  agreeTerms:     'on',
  agreeCancel:    'on',
};
