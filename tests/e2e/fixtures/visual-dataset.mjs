/**
 * The dataset the admin visual baselines are captured against.
 *
 * Every value here is fixed on purpose. The admin snapshots were previously
 * taken against whatever happened to be in the shared dev database, so a
 * `test:api` run — which writes registrations — silently changed which rows
 * survived `capAdminLists` and what status each one carried. `stubText` hides
 * the characters but not the badge class, so the baselines drifted on colour
 * alone. See "Admin badge baselines drift on data" in docs/ui-refresh-handoff.md.
 *
 * Chosen to exercise the status palette rather than to look realistic: every
 * `REG_STATUS` appears at least once, both confirmed payment states appear, and
 * two emails repeat so the customers page has a repeat customer to aggregate.
 *
 * Emails use `.test` (RFC 2606, never resolvable) so nothing here can be
 * mistaken for, or mailed to, a real person.
 */

// Fixed instants. Well in the past so no "upcoming trip" logic flips with the
// wall clock, and spaced by days so newest-first ordering is unambiguous.
const T = (d, t = '09:00:00') => `2026-05-${String(d).padStart(2, '0')} ${t}`;

export const REGISTRATIONS = [
  {
    trip_name: 'Ladakh — High Passes', trip_slug: 'ladakh-high-passes',
    trip_date: '2026-07-12', full_name: 'Asha Fixture', email: 'asha@example.test',
    phone: '+91 90000 00001', city: 'Pune', state: 'Maharashtra',
    emergency_name: 'Ravi Fixture', emergency_phone: '+91 90000 00002',
    status: 'confirmed', payment_status: 'fully_paid',
    amount_paid: 4200000, total_amount: 4200000, payment_date: '2026-05-18',
    payment_method: 'upi', transaction_id: 'FIXTURE-0001',
    created_at: T(18), updated_at: T(18),
  },
  {
    trip_name: 'Monsoon Meghalaya', trip_slug: 'monsoon-meghalaya',
    trip_date: '2026-08-02', full_name: 'Asha Fixture', email: 'asha@example.test',
    phone: '+91 90000 00001', city: 'Pune', state: 'Maharashtra',
    emergency_name: 'Ravi Fixture', emergency_phone: '+91 90000 00002',
    status: 'confirmed', payment_status: 'advance_paid',
    amount_paid: 1500000, total_amount: 3800000, payment_date: '2026-05-16',
    payment_method: 'bank_transfer', transaction_id: 'FIXTURE-0002',
    created_at: T(16), updated_at: T(16),
  },
  {
    trip_name: 'Kashmir — Valleys, Rivers, Lakes', trip_slug: 'kashmir-valleys-rivers-lakes',
    trip_date: '2026-09-05', full_name: 'Bikram Fixture', email: 'bikram@example.test',
    phone: '+91 90000 00003', city: 'Bengaluru', state: 'Karnataka',
    emergency_name: 'Meera Fixture', emergency_phone: '+91 90000 00004',
    status: 'pending', payment_status: 'unpaid',
    amount_paid: 0, total_amount: 3600000,
    created_at: T(14), updated_at: T(14),
  },
  {
    trip_name: 'Sahyadri Monsoon Retreat', trip_slug: 'sahyadri-monsoon-retreat',
    trip_date: '2026-07-26', full_name: 'Chetna Fixture', email: 'chetna@example.test',
    phone: '+91 90000 00005', city: 'Mumbai', state: 'Maharashtra',
    emergency_name: 'Nikhil Fixture', emergency_phone: '+91 90000 00006',
    status: 'lead', payment_status: 'unpaid',
    amount_paid: 0, total_amount: 1200000,
    created_at: T(12), updated_at: T(12),
  },
  {
    trip_name: 'Eastern Frontier — Arunachal', trip_slug: 'eastern-frontier-arunachal',
    trip_date: '2026-11-09', full_name: 'Devraj Fixture', email: 'devraj@example.test',
    phone: '+91 90000 00007', city: 'Delhi', state: 'Delhi',
    emergency_name: 'Sunita Fixture', emergency_phone: '+91 90000 00008',
    status: 'rejected', payment_status: 'unpaid',
    amount_paid: 0, total_amount: 5100000,
    created_at: T(10), updated_at: T(10),
  },
  {
    trip_name: 'Ladakh — High Passes', trip_slug: 'ladakh-high-passes',
    trip_date: '2026-07-12', full_name: 'Esha Fixture', email: 'esha@example.test',
    phone: '+91 90000 00009', city: 'Hyderabad', state: 'Telangana',
    emergency_name: 'Arun Fixture', emergency_phone: '+91 90000 00010',
    status: 'cancelled', payment_status: 'full_refund',
    amount_paid: 2000000, amount_refunded: 2000000, total_amount: 4200000,
    payment_date: '2026-05-08', payment_method: 'upi', transaction_id: 'FIXTURE-0003',
    created_at: T(8), updated_at: T(8),
  },
  {
    trip_name: 'Last Frontier — Arunachal, New Year', trip_slug: 'last-frontier-arunachal-new-year',
    trip_date: '2026-12-28', full_name: 'Farid Fixture', email: 'farid@example.test',
    phone: '+91 90000 00011', city: 'Kolkata', state: 'West Bengal',
    emergency_name: 'Zoya Fixture', emergency_phone: '+91 90000 00012',
    status: 'wishlist', payment_status: 'unpaid',
    amount_paid: 0, total_amount: 5900000, wishlisted_at: T(6),
    created_at: T(6), updated_at: T(6),
  },
  {
    trip_name: 'Kashmir — Valleys, Rivers, Lakes', trip_slug: 'kashmir-valleys-rivers-lakes',
    trip_date: '2026-09-05', full_name: 'Bikram Fixture', email: 'bikram@example.test',
    phone: '+91 90000 00003', city: 'Bengaluru', state: 'Karnataka',
    emergency_name: 'Meera Fixture', emergency_phone: '+91 90000 00004',
    status: 'pending', payment_status: 'unpaid',
    amount_paid: 0, total_amount: 3600000,
    created_at: T(4), updated_at: T(4),
  },
];

export const CONTACT_SUBMISSIONS = [
  {
    full_name: 'Gita Fixture', email: 'gita@example.test', phone: '+91 90000 00013',
    subject: 'Group booking for six', message: 'Asking about a private departure in September.',
    source: 'contact-form', status: 'new', created_at: T(17),
  },
  {
    full_name: 'Harsh Fixture', email: 'harsh@example.test', phone: '+91 90000 00014',
    subject: 'Kit list question', message: 'What sleeping bag rating do we need in Ladakh?',
    source: 'contact-form', status: 'resolved', created_at: T(11),
  },
];

export const NEWSLETTER_SUBSCRIBERS = [
  { email: 'asha@example.test', name: 'Asha Fixture', active: 1, status: 'subscribed', source: 'footer', subscribed_at: T(18), unsubscribe_token: 'fixture-token-0001' },
  { email: 'ira@example.test', name: 'Ira Fixture', active: 1, status: 'subscribed', source: 'homepage', subscribed_at: T(13), unsubscribe_token: 'fixture-token-0002' },
  { email: 'jai@example.test', name: 'Jai Fixture', active: 0, status: 'unsubscribed', source: 'footer', subscribed_at: T(9), unsubscribe_token: 'fixture-token-0003' },
];

export const EMAIL_DELIVERY_LOG = [
  { id: 'fixture-mail-0001', template: 'booking-confirmed', recipient: 'asha@example.test', subject: 'Your Ladakh booking is confirmed', status: 'sent', provider_id: 'FIXTURE-SMTP-1', created_at: T(18), completed_at: T(18, '09:00:04') },
  { id: 'fixture-mail-0002', template: 'payment-reminder', recipient: 'bikram@example.test', subject: 'Balance due for Kashmir', status: 'sent', provider_id: 'FIXTURE-SMTP-2', created_at: T(14), completed_at: T(14, '09:00:03') },
  { id: 'fixture-mail-0003', template: 'welcome', recipient: 'jai@example.test', subject: 'Welcome to the list', status: 'failed', error_summary: 'Mailbox unavailable (fixture)', created_at: T(9), completed_at: T(9, '09:00:07') },
];

// `previousValue` / `newValue` are JSON documents, not labels: /admin/audit
// runs them through `JSON.parse` to render the before/after block, and a bare
// string there 500s the page.
export const AUDIT_LOG = [
  { id: 'fixture-audit-0001', actorEmail: 'owner@example.test', actorRole: 'owner', action: 'registration.status_changed', targetType: 'registration', targetId: '1', previousValue: JSON.stringify({ status: 'pending' }), newValue: JSON.stringify({ status: 'confirmed' }), ipAddress: '203.0.113.10', createdAt: T(18) },
  { id: 'fixture-audit-0002', actorEmail: 'ops@example.test', actorRole: 'ops', action: 'registration.payment_recorded', targetType: 'registration', targetId: '2', previousValue: JSON.stringify({ payment_status: 'unpaid', amount_paid: 0 }), newValue: JSON.stringify({ payment_status: 'advance_paid', amount_paid: 1500000 }), ipAddress: '203.0.113.11', createdAt: T(16) },
  { id: 'fixture-audit-0003', actorEmail: 'owner@example.test', actorRole: 'owner', action: 'settings.updated', targetType: 'settings', targetId: 'site', previousValue: null, newValue: JSON.stringify({ hero_headline: 'Fixture headline' }), ipAddress: '203.0.113.10', createdAt: T(10) },
];

export const CUSTOM_ITINERARY_LEADS = [
  { name: 'Kabir Fixture', email: 'kabir@example.test', phone: '+91 90000 00015', destination: 'Spiti', travellers: '4', dates: 'Sept 2026', budget: '2-3L', message: 'Anything with a homestay stretch.', status: 'new', created_at: T(15) },
];

/** Every table the seed owns, in delete order (children before parents). */
export const TABLES = {
  registrations: REGISTRATIONS,
  contact_submissions: CONTACT_SUBMISSIONS,
  newsletter_subscribers: NEWSLETTER_SUBSCRIBERS,
  email_delivery_log: EMAIL_DELIVERY_LOG,
  audit_log: AUDIT_LOG,
  custom_itinerary_leads: CUSTOM_ITINERARY_LEADS,
};

/**
 * Wiped but not repopulated: these carry per-run noise (a login session, a page
 * view) that would otherwise accumulate across runs and move a baseline.
 */
export const WIPE_ONLY = [
  'admin_sessions',
  'user_sessions',
  'analytics_messages',
  'analytics_sessions',
  'analytics_audit_log',
  'payment_events',
  'broadcast_log',
  'leaderboard_cache',
  'geocode_cache',
];
