import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { readTrip, readSiteSettings, upcomingBatches } from '../../lib/content';
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

    // ── Server-side departure + price resolution (never trust the client) ──
    const fail = (msg: string) => new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );

    const hasBatchArray = Array.isArray(trip?.batches) && trip!.batches.length > 0;
    let selectedBatch: any = null;
    let batchId: string | null = null;

    if (hasBatchArray) {
      batchId = sanitizeInput(body.batchId) || null;
      if (!batchId) return fail('Please select a departure date.');
      // Must be one of the currently-bookable departures (upcoming, not draft/completed).
      const bookable = upcomingBatches(trip!);
      selectedBatch = bookable.find((b: any) => b.id === batchId);
      if (!selectedBatch) return fail('That departure date is no longer available. Please pick another.');
      // And it must not be sold out (by explicit status or by full seats).
      const full = selectedBatch.totalSpots != null && (selectedBatch.bookedSpots ?? 0) >= selectedBatch.totalSpots;
      if (selectedBatch.status === 'sold-out' || selectedBatch.status === 'sold_out' || full) {
        return fail('That departure date is sold out. Please pick another.');
      }
    }

    // Occupancy: derive the total from the trip's own options, not the client.
    const sharingOpts = (Array.isArray(trip?.sharingOptions) ? trip!.sharingOptions : [])
      .filter((o: any) => o && o.label && Number.isFinite(Number(o.price)));
    let sharingOption: string | null = null;
    let totalAmount: number | null = null;

    if (sharingOpts.length > 0) {
      const wanted = sanitizeInput(body.sharingOption);
      const match = sharingOpts.find((o: any) => o.label === wanted) ?? sharingOpts[0];
      sharingOption = match.label;
      totalAmount = Math.round(Number(match.price));
    } else {
      const base = selectedBatch?.price ?? (trip as any)?.pricePerPerson ?? null;
      totalAmount = Number.isFinite(Number(base)) ? Math.round(Number(base)) : null;
    }

    // Departure date string, derived from the resolved batch (or legacy fields).
    const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const tripDateStr = selectedBatch
      ? `${fmtDate(selectedBatch.startDate)} – ${fmtDate(selectedBatch.endDate)}`
      : ((trip as any)?.startDate ? `${fmtDate((trip as any).startDate)} – ${fmtDate((trip as any).endDate ?? (trip as any).startDate)}` : (sanitizeInput(body.tripDate) || ''));

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO registrations (
        trip_name, trip_date, full_name, email, phone, gender,
        age, city, instagram, emergency_name, emergency_phone,
        payment_screenshot_url, why_join,
        sharing_option, total_amount, batch_id, consent_at, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, CURRENT_TIMESTAMP, 'pending'
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
      sanitizeInput(body.paymentScreenshotUrl) || null,
      required.whyJoin,
      sharingOption,
      totalAmount,
      batchId,
    );

    const registrationId = insertResult.lastInsertRowid;

    // Resolve trip/batch data for email
    const tripName = sanitizeInput(body.tripName);
    // Prefer the booked departure; fall back to the first batch.
    const emailBatch = selectedBatch ?? (trip?.batches ?? [])[0];
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const startDate = emailBatch?.startDate ? fmt(emailBatch.startDate) : (sanitizeInput(body.tripDate) || 'TBD');
    const endDate   = emailBatch?.endDate   ? fmt(emailBatch.endDate)   : startDate;
    const advanceAmount = (trip as any)?.paymentAmount ?? 3000;

    let whatsappLink = 'https://wa.me/917975027491';
    let upiId = '';
    try {
      const s = readSiteSettings();
      if (s.whatsappLink) whatsappLink = s.whatsappLink;
      if (s.upiId) upiId = s.upiId;
    } catch {}

    const hasPayment = !!(sanitizeInput(body.paymentScreenshotUrl));
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
