import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { sendRegistrationConfirmation, sendAdminRegistrationNotification } from '../../lib/email';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../lib/utils';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

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
        payment_screenshot_url, why_join, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, 'pending'
      )
    `);

    stmt.run(
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
      required.whyJoin,
    );

    // Send emails (fire and forget)
    sendRegistrationConfirmation({
      name:     required.fullName,
      email:    required.email,
      tripName: sanitizeInput(body.tripName),
      tripDate: sanitizeInput(body.tripDate),
      duration: sanitizeInput(body.tripDuration) || 'N/A',
    }).catch(console.error);

    sendAdminRegistrationNotification({
      trip_name:       sanitizeInput(body.tripName),
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
