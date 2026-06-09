import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { readTrip, readSiteSettings, resolveBooking } from '../../lib/content';
import { sendRegistrationPaymentReceived, sendRegistrationPaymentPending, sendAdminRegistrationNotification } from '../../lib/email';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../lib/utils';
import { rateLimit } from '../../lib/rateLimit';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!rateLimit(clientAddress, 5, 60 * 60 * 1000)) {
    return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  try {
    const body = await request.json();

    // Block booking for sold-out trips
    const tripSlug = sanitizeInput(body.tripSlug);
    const trip = tripSlug ? readTrip(tripSlug) : null;
    if (trip?.status === 'sold-out') {
      return new Response(JSON.stringify({ success: false, error: 'This trip is sold out.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Honeypot check
    if (body._honey) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid submission.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Required field validation
    const required: Record<string, string> = {
      fullName:       sanitizeInput(body.fullName),
      email:          sanitizeInput(body.email),
      phone:          sanitizeInput(body.phone),
      age:            sanitizeInput(body.age),
      city:           sanitizeInput(body.city),
      instagram:      sanitizeInput(body.instagram),
      emergencyName:  sanitizeInput(body.emergencyName),
      emergencyPhone: sanitizeInput(body.emergencyPhone),
      whyJoin:        sanitizeInput(body.whyJoin),
    };

    for (const [field, value] of Object.entries(required)) {
      if (!value) {
        return new Response(JSON.stringify({ success: false, error: `Missing required field: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (!isValidEmail(required.email)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!isValidPhone(required.phone)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid phone number.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Consent: both the Terms and Cancellation policy must be accepted. Checkboxes
    // post as 'on'/true; treat anything else as not accepted (blocks non-JS/tampered submits).
    const truthy = (v: any) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
    if (!truthy(body.agreeTerms) || !truthy(body.agreeCancel)) {
      return new Response(JSON.stringify({ success: false, error: 'Please accept the Terms and Cancellation Policy to continue.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Server-side departure + occupancy resolution (never trust the client) ──
    // resolveBooking() is the single source of truth: it filters to bookable
    // departures and resolves per-departure offers (new schema or legacy).
    const fail = (msg: string) => new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );

    const booking = resolveBooking(trip!);
    if (booking.departures.length === 0) return fail('This trip has no bookable dates right now.');

    const wantedDeparture = sanitizeInput(body.batchId) || null;
    const selectedDeparture = wantedDeparture
      ? booking.departures.find((d) => d.id === wantedDeparture)
      : booking.departures.find((d) => !d.soldOut);
    if (!selectedDeparture) return fail('That departure date is no longer available. Please pick another.');
    if (selectedDeparture.soldOut) return fail('That departure date is sold out. Please pick another.');

    const batchId: string = selectedDeparture.id;

    // Occupancy: pick the requested available offer; fall back to cheapest available.
    const wantedTier = sanitizeInput(body.tierId) || null;
    const availableOffers = selectedDeparture.offers.filter((o) => o.available);
    if (availableOffers.length === 0) return fail('That departure date is sold out. Please pick another.');
    const cheapest = availableOffers.reduce((min, o) => (o.price < min.price ? o : min), availableOffers[0]);
    const selectedOffer =
      (wantedTier && availableOffers.find((o) => o.tierId === wantedTier)) || cheapest;

    const sharingOption: string | null = booking.occupancyCatalog.length > 1 ? selectedOffer.label : null;
    const totalAmount: number = selectedOffer.price;

    // Departure date string, derived from the resolved departure.
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const tripDateStr = `${fmtDate(selectedDeparture.startDate)} – ${fmtDate(selectedDeparture.endDate)}`;

    // Status: 'pending' when screenshot uploaded (awaiting ops verification);
    // 'lead' when no screenshot (registered but unpaid — holds no seat).
    const screenshotUrl = sanitizeInput(body.paymentScreenshotUrl) || null;
    const registrationStatus = screenshotUrl ? 'pending' : 'lead';

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO registrations (
        trip_name, trip_date, full_name, email, phone, gender,
        age, city, instagram, emergency_name, emergency_phone,
        payment_screenshot_url, why_join,
        sharing_option, total_amount, batch_id, tier_id, consent_at, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, CURRENT_TIMESTAMP, ?
      )
    `);

    const insertResult = stmt.run(
      sanitizeInput(body.tripName),
      tripDateStr,
      required.fullName,
      required.email,
      required.phone,
      sanitizeInput(body.gender) || null,
      required.age,
      required.city,
      required.instagram,
      required.emergencyName,
      required.emergencyPhone,
      screenshotUrl,
      required.whyJoin,
      sharingOption,
      totalAmount,
      batchId,
      selectedOffer.tierId,
      registrationStatus,
    );

    const registrationId = insertResult.lastInsertRowid;

    // Resolve trip data for email from the booked departure.
    const tripName = sanitizeInput(body.tripName);
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const startDate = fmt(selectedDeparture.startDate);
    const endDate   = fmt(selectedDeparture.endDate);
    const advanceAmount = booking.advanceAmount;

    let whatsappLink = 'https://wa.me/917975027491';
    let upiId = '';
    try {
      const s = readSiteSettings();
      if (s.whatsappLink) whatsappLink = s.whatsappLink;
      if (s.upiId) upiId = s.upiId;
    } catch {}

    const hasPayment = !!screenshotUrl;
    const firstName = required.fullName.split(' ')[0];

    // Send confirmation email — wrapped so failure never blocks success response
    let emailSent = 0;
    try {
      if (hasPayment) {
        await sendRegistrationPaymentReceived({ firstName, email: required.email, tripName, startDate, endDate, whatsappLink });
      } else {
        await sendRegistrationPaymentPending({ firstName, email: required.email, tripName, startDate, endDate, advanceAmount, whatsappLink, upiId });
      }
      emailSent = 1;
    } catch (emailErr) {
      console.error('[Register email error]', emailErr);
    }

    try { db.prepare('UPDATE registrations SET email_sent = ? WHERE id = ?').run(emailSent, registrationId); } catch {}

    sendAdminRegistrationNotification({
      trip_name:       tripName,
      full_name:       required.fullName,
      email:           required.email,
      phone:           required.phone,
      gender:          sanitizeInput(body.gender) || '—',
      city:            required.city,
      emergency_name:  required.emergencyName,
      emergency_phone: required.emergencyPhone,
      why_join:        required.whyJoin,
      screenshot_url:  sanitizeInput(body.paymentScreenshotUrl) || '—',
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, message: 'Registration successful!' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Register API Error]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
