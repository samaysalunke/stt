import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { readTrip, readSiteSettings } from '../../lib/content';
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
      fullName:      sanitizeInput(body.fullName),
      email:         sanitizeInput(body.email),
      phone:         sanitizeInput(body.phone),
      city:          sanitizeInput(body.city),
      emergencyName: sanitizeInput(body.emergencyName),
      emergencyPhone: sanitizeInput(body.emergencyPhone),
      whyJoin:       sanitizeInput(body.whyJoin),
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

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO registrations (
        trip_name, trip_date, full_name, email, phone, gender,
        city, emergency_name, emergency_phone,
        payment_screenshot_url, transaction_id, why_join, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, 'pending'
      )
    `);

    const insertResult = stmt.run(
      sanitizeInput(body.tripName),
      sanitizeInput(body.tripDate),
      required.fullName,
      required.email,
      required.phone,
      sanitizeInput(body.gender) || null,
      required.city,
      required.emergencyName,
      required.emergencyPhone,
      sanitizeInput(body.paymentScreenshotUrl) || null,
      sanitizeInput(body.transactionId) || null,
      required.whyJoin,
    );

    const registrationId = insertResult.lastInsertRowid;

    // Resolve trip/batch data for email
    const tripName = sanitizeInput(body.tripName);
    const firstBatch = (trip?.batches ?? [])[0];
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const startDate = firstBatch?.startDate ? fmt(firstBatch.startDate) : (sanitizeInput(body.tripDate) || 'TBD');
    const endDate   = firstBatch?.endDate   ? fmt(firstBatch.endDate)   : startDate;
    const advanceAmount = (trip as any)?.paymentAmount ?? 3000;

    let whatsappLink = 'https://wa.me/917975027491';
    try {
      const s = readSiteSettings();
      if (s.whatsappLink) whatsappLink = s.whatsappLink;
    } catch {}

    const hasPayment = !!(sanitizeInput(body.paymentScreenshotUrl)) && !!(sanitizeInput(body.transactionId));
    const firstName = required.fullName.split(' ')[0];

    // Send confirmation email — wrapped so failure never blocks success response
    let emailSent = 0;
    try {
      if (hasPayment) {
        await sendRegistrationPaymentReceived({ firstName, email: required.email, tripName, startDate, endDate, whatsappLink });
      } else {
        await sendRegistrationPaymentPending({ firstName, email: required.email, tripName, startDate, endDate, advanceAmount, whatsappLink });
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
