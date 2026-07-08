import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { readTrip, readSiteSettings, resolveBooking } from '../../lib/content';
import { sendRegistrationPaymentReceived, sendRegistrationPaymentPending, sendAdminRegistrationNotification } from '../../lib/email';
import { sanitizeInput, isValidEmail, isValidPhone, formatDateIN } from '../../lib/utils';
import { rateLimit } from '../../lib/rateLimit';
import { geocodeCity } from '../../lib/geocode';

const truthy = (v: any) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;

function json(body: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Upsert keyed on (email, trip_slug, batch_id) + status='lead'. Shared by the
// details-only (Step 2) and payment (Step 3) paths so the two never drift.
function findOrCreateLead(db: ReturnType<typeof getDb>, p: {
  tripName: string; tripSlug: string; tripDateStr: string; fullName: string; email: string; phone: string;
  gender: string | null; age: string; city: string; instagram: string | null;
  emergencyName: string; emergencyPhone: string; whyJoin: string;
  sharingOption: string | null; totalAmount: number; batchId: string; tierId: string;
}): { id: number; isNew: boolean } {
  const existing = db.prepare(`
    SELECT id FROM registrations
    WHERE lower(trim(email)) = lower(trim(?)) AND trip_slug = ? AND batch_id = ? AND status = 'lead'
    LIMIT 1
  `).get(p.email, p.tripSlug, p.batchId) as { id: number } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE registrations SET
        trip_name=?, trip_date=?, full_name=?, email=?, phone=?, gender=?,
        age=?, city=?, instagram=?, emergency_name=?, emergency_phone=?,
        why_join=?, sharing_option=?, total_amount=?, tier_id=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      p.tripName, p.tripDateStr, p.fullName, p.email, p.phone, p.gender,
      p.age, p.city, p.instagram, p.emergencyName, p.emergencyPhone,
      p.whyJoin, p.sharingOption, p.totalAmount, p.tierId,
      existing.id,
    );
    return { id: existing.id, isNew: false };
  }

  const insert = db.prepare(`
    INSERT INTO registrations (
      trip_name, trip_slug, trip_date, full_name, email, phone, gender,
      age, city, instagram, emergency_name, emergency_phone,
      why_join, sharing_option, total_amount, batch_id, tier_id,
      source, status, status_changed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'lead', CURRENT_TIMESTAMP)
  `).run(
    p.tripName, p.tripSlug, p.tripDateStr, p.fullName, p.email, p.phone, p.gender,
    p.age, p.city, p.instagram, p.emergencyName, p.emergencyPhone,
    p.whyJoin, p.sharingOption, p.totalAmount, p.batchId, p.tierId,
    'checkout',
  );
  return { id: Number(insert.lastInsertRowid), isNew: true };
}

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  if (!rateLimit(`register:${clientAddress}`, 30, 60 * 60 * 1000)) {
    return json({ success: false, error: 'Too many requests. Please try again later.' }, 429);
  }

  try {
    const body = await request.json();
    if (body._honey) return json({ success: false, error: 'Invalid submission.' }, 400);

    const tripSlug = sanitizeInput(body.tripSlug);
    const trip = tripSlug ? readTrip(tripSlug) : null;
    if (!trip) return json({ success: false, error: 'Trip not found.' }, 404);

    const required: Record<string, string> = {
      fullName:       sanitizeInput(body.fullName),
      email:          sanitizeInput(locals.user?.email ?? body.email),
      phone:          sanitizeInput(body.phone),
      age:            sanitizeInput(body.age),
      city:           sanitizeInput(body.city),
      emergencyName:  sanitizeInput(body.emergencyName),
      emergencyPhone: sanitizeInput(body.emergencyPhone),
      whyJoin:        sanitizeInput(body.whyJoin),
    };

    for (const [field, value] of Object.entries(required)) {
      if (!value) return json({ success: false, error: `Missing required field: ${field}` }, 400);
    }
    if (!isValidEmail(required.email)) return json({ success: false, error: 'Invalid email address.' }, 400);
    if (!isValidPhone(required.phone)) return json({ success: false, error: 'Invalid phone number.' }, 400);

    const ageNum = Number(required.age);
    if (!Number.isInteger(ageNum) || ageNum < 16 || ageNum > 100) {
      return json({ success: false, error: 'Please enter a valid age (16–100).' }, 400);
    }

    const booking = resolveBooking(trip);
    if (booking.departures.length === 0) return json({ success: false, error: 'This trip has no bookable dates right now.' }, 400);

    const wantedDeparture = sanitizeInput(body.batchId) || null;
    const selectedDeparture = wantedDeparture
      ? booking.departures.find((d) => d.id === wantedDeparture)
      : (booking.departures.find((d) => !d.soldOut) ?? booking.departures[0]);
    if (!selectedDeparture) return json({ success: false, error: 'That departure date is no longer available. Please pick another.' }, 400);
    if (selectedDeparture.soldOut) return json({ success: false, error: 'This trip is sold out. Please pick another departure.' }, 400);

    const batchId = selectedDeparture.id;
    const wantedTier = sanitizeInput(body.tierId) || null;
    const availableOffers = selectedDeparture.offers.filter((o) => o.available);
    if (availableOffers.length === 0) return json({ success: false, error: 'That departure date is sold out. Please pick another.' }, 400);
    const cheapest = availableOffers.reduce((min, o) => (o.price < min.price ? o : min), availableOffers[0]);
    const selectedOffer = (wantedTier && availableOffers.find((o) => o.tierId === wantedTier)) || cheapest;

    const sharingOption = booking.occupancyCatalog.length > 1 ? selectedOffer.label : null;
    const totalAmount = selectedOffer.price;
    const instagram = sanitizeInput(body.instagram) || null;
    const tripName = sanitizeInput(body.tripName) || String(trip.title || trip.name || tripSlug);
    const tripDateStr = `${formatDateIN(selectedDeparture.startDate)} – ${formatDateIN(selectedDeparture.endDate)}`;
    const screenshotUrl = sanitizeInput(body.paymentScreenshotUrl) || null;
    const submittingPayment = !!screenshotUrl;
    const detailsOnly = sanitizeInput(body.intent) === 'details';
    const db = getDb();

    const existingPaid = db.prepare(`
      SELECT id, status FROM registrations
      WHERE lower(trim(email)) = lower(trim(?)) AND trip_slug = ? AND batch_id = ? AND status IN ('pending','confirmed')
      LIMIT 1
    `).get(required.email, tripSlug, batchId) as { id: number; status: string } | undefined;

    if (!submittingPayment && existingPaid) {
      // Already pending/confirmed — payment fields stay untouched, but a
      // returning traveller editing a typo'd detail shouldn't have it silently dropped.
      db.prepare(`
        UPDATE registrations SET
          full_name=?, phone=?, gender=?, age=?, city=?, instagram=?,
          emergency_name=?, emergency_phone=?, why_join=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(
        required.fullName, required.phone, sanitizeInput(body.gender) || null,
        required.age, required.city, instagram, required.emergencyName, required.emergencyPhone,
        required.whyJoin, existingPaid.id,
      );
      return json({ success: true, status: existingPaid.status, registrationId: existingPaid.id });
    }
    if (submittingPayment && existingPaid?.status === 'confirmed') {
      return json({ success: true, status: 'confirmed', registrationId: existingPaid.id });
    }

    if (!submittingPayment && !detailsOnly && (!truthy(body.agreeTerms) || !truthy(body.agreeCancel))) {
      return json({ success: false, error: 'Please accept the Terms and Cancellation Policy to continue.' }, 400);
    }

    if (!submittingPayment) {
      const { id: leadId, isNew } = findOrCreateLead(db, {
        tripName, tripSlug, tripDateStr, fullName: required.fullName, email: required.email, phone: required.phone,
        gender: sanitizeInput(body.gender) || null, age: required.age, city: required.city, instagram,
        emergencyName: required.emergencyName, emergencyPhone: required.emergencyPhone, whyJoin: required.whyJoin,
        sharingOption, totalAmount, batchId, tierId: selectedOffer.tierId,
      });

      if (isNew) {
        let whatsappLink = 'https://wa.me/917975027491';
        let upiId = '';
        try {
          const s = readSiteSettings();
          if (s.whatsappLink) whatsappLink = s.whatsappLink;
          if (s.upiId) upiId = s.upiId;
        } catch {}
        const firstName = required.fullName.split(' ')[0];
        sendRegistrationPaymentPending({
          firstName, email: required.email, tripName,
          startDate: formatDateIN(selectedDeparture.startDate),
          endDate: formatDateIN(selectedDeparture.endDate),
          advanceAmount: booking.advanceAmount,
          whatsappLink,
          upiId,
        }).then(() => {
          try { db.prepare('UPDATE registrations SET email_sent = 1 WHERE id = ?').run(leadId); } catch {}
        }).catch((emailErr) => {
          console.error('[Register lead email error]', emailErr);
          try { db.prepare('UPDATE registrations SET email_error = ? WHERE id = ?').run(String(emailErr?.message ?? emailErr), leadId); } catch {}
        });

        if (required.city) geocodeCity(required.city).catch(() => {});
      }

      return json({ success: true, status: 'lead', registrationId: leadId });
    }

    if (!truthy(body.agreeTerms) || !truthy(body.agreeCancel)) {
      return json({ success: false, error: 'Please accept the Terms and Cancellation Policy to continue.' }, 400);
    }

    // A lead row ('status=lead') is the normal case — Step 2 always creates one first.
    // If none exists but there's already a 'pending' row for this identity (e.g. the
    // traveller corrected their screenshot via the back button, see recovery flow),
    // reuse that row instead of silently discarding the resubmit.
    const hasLeadRow = !!db.prepare(`
      SELECT 1 FROM registrations
      WHERE lower(trim(email)) = lower(trim(?)) AND trip_slug = ? AND batch_id = ? AND status = 'lead'
      LIMIT 1
    `).get(required.email, tripSlug, batchId);

    const leadId = (!hasLeadRow && existingPaid?.status === 'pending')
      ? existingPaid.id
      : findOrCreateLead(db, {
          tripName, tripSlug, tripDateStr, fullName: required.fullName, email: required.email, phone: required.phone,
          gender: sanitizeInput(body.gender) || null, age: required.age, city: required.city, instagram,
          emergencyName: required.emergencyName, emergencyPhone: required.emergencyPhone, whyJoin: required.whyJoin,
          sharingOption, totalAmount, batchId, tierId: selectedOffer.tierId,
        }).id;

    db.prepare(`
      UPDATE registrations SET
        trip_name=?, trip_date=?, full_name=?, email=?, phone=?, gender=?,
        age=?, city=?, instagram=?, emergency_name=?, emergency_phone=?,
        payment_screenshot_url=?, why_join=?, sharing_option=?, total_amount=?,
        tier_id=?, consent_at=CURRENT_TIMESTAMP, status='pending',
        status_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      tripName, tripDateStr, required.fullName, required.email, required.phone, sanitizeInput(body.gender) || null,
      required.age, required.city, instagram, required.emergencyName, required.emergencyPhone,
      screenshotUrl, required.whyJoin, sharingOption, totalAmount,
      selectedOffer.tierId, leadId,
    );

    let whatsappLink = 'https://wa.me/917975027491';
    try {
      const s = readSiteSettings();
      if (s.whatsappLink) whatsappLink = s.whatsappLink;
    } catch {}

    const firstName = required.fullName.split(' ')[0];
    sendRegistrationPaymentReceived({
      firstName,
      email: required.email,
      tripName,
      startDate: formatDateIN(selectedDeparture.startDate),
      endDate: formatDateIN(selectedDeparture.endDate),
      whatsappLink,
    }).then(() => {
      try { db.prepare('UPDATE registrations SET email_sent = 1 WHERE id = ?').run(leadId); } catch {}
    }).catch((emailErr) => {
      console.error('[Register payment email error]', emailErr);
      try { db.prepare('UPDATE registrations SET email_error = ? WHERE id = ?').run(String(emailErr?.message ?? emailErr), leadId); } catch {}
    });

    sendAdminRegistrationNotification({
      trip_name: tripName,
      full_name: required.fullName,
      email: required.email,
      phone: required.phone,
      gender: sanitizeInput(body.gender) || '-',
      city: required.city,
      emergency_name: required.emergencyName,
      emergency_phone: required.emergencyPhone,
      why_join: required.whyJoin,
      screenshot_url: screenshotUrl || '-',
    }).catch(console.error);

    if (required.city) geocodeCity(required.city).catch(() => {});
    return json({ success: true, status: 'pending', registrationId: leadId });
  } catch (err) {
    console.error('[Register API Error]', err);
    return json({ success: false, error: 'Server error. Please try again.' }, 500);
  }
};
