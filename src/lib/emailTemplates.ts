import { escapeHtml, wrapEmail, sendEmail, ADMIN_EMAIL } from './emailTransport';
import type { EmailAttachment } from './emailTransport';
import { readSiteSettings } from './settings';
import { siteUrl } from './siteUrl';

function getWhatsappLink(): string {
  try {
    const s = readSiteSettings();
    return s.whatsappLink || 'https://wa.me/917975027491';
  } catch {
    return 'https://wa.me/917975027491';
  }
}

export async function sendAdminRegistrationNotification(data: Record<string, any>) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #E8725A; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="color: white; margin: 0;">New Trip Registration</h2>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #F5DDD7;">
    <h3 style="color: #E8725A; margin-top: 0;">Trip: ${escapeHtml(data.trip_name)}</h3>
    <table style="width: 100%; border-collapse: collapse;">
      ${Object.entries(data).map(([k, v]) =>
        `<tr style="border-bottom: 1px solid #f0f0f0;">
          <td style="padding: 8px; color: #666; width: 40%; text-transform: capitalize;">${escapeHtml(k.replace(/_/g, ' '))}</td>
          <td style="padding: 8px; font-weight: 500;">${escapeHtml(v)}</td>
        </tr>`
      ).join('')}
    </table>
  </div>
</body>
</html>`;

  await sendEmail(ADMIN_EMAIL, `New Trip Registration — ${data.trip_name}`, html, { template: 'admin-registration-notification' });
}

export async function sendRegistrationStatusConfirmed(data: {
  full_name: string;
  email: string;
  trip_name: string;
  trip_date?: string;
}) {
  const whatsappLink = getWhatsappLink();
  const html = wrapEmail(`
    <h2 style="color: #1B2B3A; margin-top: 0;">Your booking is confirmed!</h2>
    <p style="margin: 0 0 16px;">Hi <strong>${escapeHtml(data.full_name)}</strong>,</p>
    <p style="margin: 0 0 24px;">Great news — your booking for <strong>${escapeHtml(data.trip_name)}</strong> has been <strong style="color:#E8725A;">confirmed</strong>!</p>
    ${data.trip_date ? `<p style="background:#FDF0EC;padding:12px 16px;border-radius:8px;margin:0 0 24px;"><strong>Trip Date:</strong> ${escapeHtml(data.trip_date)}</p>` : ''}
    <div style="background:#FDF0EC;border-radius:8px;padding:20px;margin:0 0 24px;">
      <h3 style="color:#E8725A;margin-top:0;font-size:15px;">What happens next:</h3>
      <ul style="color:#1B2B3A;padding-left:20px;margin:0;line-height:1.8;">
        <li>You'll receive a detailed trip preparation guide shortly</li>
        <li>You'll be added to the trip WhatsApp group</li>
        <li>Pre-trip briefing details will be shared a few days before departure</li>
        <li>Ensure your remaining balance is paid before departure</li>
      </ul>
    </div>
    <p style="margin:0;font-size:14px;color:#6B7280;">Questions? <a href="${escapeHtml(whatsappLink)}" style="color:#E8725A;font-weight:600;">WhatsApp us.</a></p>
  `);

  await sendEmail(data.email, `Booking Confirmed — ${data.trip_name} | Seek the Thrill`, html, { template: 'registration-confirmed' });
}

/**
 * One branded confirmation email sent by us (Resend) whenever a booking is
 * confirmed with a payment recorded. Carries the Zoho invoice PDF when the
 * accounting worker produced one; degrades to a no-attachment email otherwise.
 */
export async function sendRegistrationPaymentConfirmed(data: {
  full_name: string;
  email: string;
  trip_name: string;
  trip_date?: string;
  kind: 'advance' | 'full';
  amountPaid: number;
  totalAmount: number;
  balanceDue: number;
  whatsappLink?: string;
  attachment?: EmailAttachment;
}) {
  const whatsappLink = data.whatsappLink || getWhatsappLink();
  const inr = (n: number) => `₹${(Math.round(Number(n)) || 0).toLocaleString('en-IN')}`;
  const isFull = data.kind === 'full';
  const paidInFull = isFull || data.balanceDue <= 0;
  // A "paid in full" confirmation must never show ₹0 received. If the caller
  // couldn't resolve the paid amount (e.g. the ledger row was reset after the
  // invoice job was queued), fall back to the trip total so the figure and the
  // "paid in full" wording agree.
  const amountReceived = paidInFull && (Math.round(Number(data.amountPaid)) || 0) <= 0
    ? data.totalAmount
    : data.amountPaid;
  const balanceRow = paidInFull
    ? `<tr><td style="padding:8px 0;color:#6B7280;">Balance due</td><td style="padding:8px 0;font-weight:700;color:#065F46;text-align:right;">Paid in full</td></tr>`
    : `<tr><td style="padding:8px 0;color:#6B7280;">Balance due before departure</td><td style="padding:8px 0;font-weight:700;color:#1B2B3A;text-align:right;">${inr(data.balanceDue)}</td></tr>`;
  const html = wrapEmail(`
    <h2 style="color: #1B2B3A; margin-top: 0;">Your booking is confirmed!</h2>
    <p style="margin: 0 0 16px;">Hi <strong>${escapeHtml(data.full_name)}</strong>,</p>
    <p style="margin: 0 0 24px;">Great news — your booking for <strong>${escapeHtml(data.trip_name)}</strong> has been <strong style="color:#E8725A;">confirmed</strong>${paidInFull ? ' and paid in full' : ''}.</p>
    ${data.trip_date ? `<p style="background:#FDF0EC;padding:12px 16px;border-radius:8px;margin:0 0 24px;"><strong>Trip Date:</strong> ${escapeHtml(data.trip_date)}</p>` : ''}
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px;">
      <tr><td style="padding:8px 0;color:#6B7280;">Amount received</td><td style="padding:8px 0;font-weight:700;color:#1B2B3A;text-align:right;">${inr(amountReceived)}</td></tr>
      <tr><td style="padding:8px 0;color:#6B7280;border-top:1px solid #F5DDD7;">Trip total</td><td style="padding:8px 0;font-weight:700;color:#1B2B3A;text-align:right;border-top:1px solid #F5DDD7;">${inr(data.totalAmount)}</td></tr>
      ${balanceRow}
    </table>
    <div style="background:#FDF0EC;border-radius:8px;padding:20px;margin:0 0 24px;">
      <h3 style="color:#E8725A;margin-top:0;font-size:15px;">What happens next:</h3>
      <ul style="color:#1B2B3A;padding-left:20px;margin:0;line-height:1.8;">
        <li>You'll receive a detailed trip preparation guide shortly</li>
        <li>You'll be added to the trip WhatsApp group</li>
        <li>Pre-trip briefing details will be shared a few days before departure</li>
        ${paidInFull ? '' : '<li>Ensure your remaining balance is paid before departure</li>'}
      </ul>
    </div>
    ${data.attachment ? `<p style="margin:0 0 16px;font-size:14px;color:#1B2B3A;">Your invoice is attached to this email for your records.</p>` : ''}
    <p style="margin:0;font-size:14px;color:#6B7280;">Questions? <a href="${escapeHtml(whatsappLink)}" style="color:#E8725A;font-weight:600;">WhatsApp us.</a></p>
  `);

  await sendEmail(
    data.email,
    `Booking Confirmed — ${data.trip_name} | Seek the Thrill`,
    html,
    { template: 'registration-payment-confirmed' },
    data.attachment ? [data.attachment] : [],
  );
}

export async function sendFinancialDocument(data: {
  fullName: string;
  email: string;
  tripName: string;
  documentType: 'advance' | 'final';
  documentNumber: string;
  attachment: EmailAttachment;
}) {
  const isFinal = data.documentType === 'final';
  const html = wrapEmail(`
    <h2 style="color:#1B2B3A;margin-top:0;">${isFinal ? 'Full payment received' : 'Your spot is confirmed'}</h2>
    <p style="margin:0 0 16px;">Hi <strong>${escapeHtml(data.fullName)}</strong>,</p>
    <p style="margin:0 0 16px;">${isFinal
      ? `We've received your full payment for <strong>${escapeHtml(data.tripName)}</strong>.`
      : `We've verified your advance for <strong>${escapeHtml(data.tripName)}</strong> and confirmed your seat.`}</p>
    <p style="background:#FDF0EC;padding:14px 16px;border-radius:8px;margin:0 0 20px;">
      ${isFinal ? 'Paid invoice' : 'Advance document'}: <strong>${escapeHtml(data.documentNumber)}</strong>
    </p>
    <p style="margin:0;color:#6B7280;font-size:14px;">Your Zoho Books PDF is attached for your records.</p>
  `);
  await sendEmail(
    data.email,
    `${isFinal ? 'Paid invoice' : 'Booking confirmed'} — ${data.tripName} | Seek the Thrill`,
    html,
    { template: isFinal ? 'registration-final-invoice' : 'registration-advance-document' },
    [data.attachment],
  );
}

export async function sendFinancialConfirmationWithoutDocument(data: {
  fullName: string;
  email: string;
  tripName: string;
  documentType: 'advance' | 'final';
}) {
  const final = data.documentType === 'final';
  const html = wrapEmail(`
    <h2 style="color:#1B2B3A;margin-top:0;">${final ? 'Full payment received' : 'Your spot is confirmed'}</h2>
    <p>Hi <strong>${escapeHtml(data.fullName)}</strong>,</p>
    <p>${final ? 'Your balance payment has been recorded.' : `Your advance has been verified and your seat on <strong>${escapeHtml(data.tripName)}</strong> is confirmed.`}</p>
    <p style="color:#6B7280;font-size:14px;">Our accounting document service is taking longer than expected. We'll send the PDF separately as soon as it is ready.</p>
  `);
  await sendEmail(data.email, `${final ? 'Full payment received' : 'Booking confirmed'} — ${data.tripName} | Seek the Thrill`, html, { template: `${data.documentType}-confirmation-pdf-delayed` });
}

export async function sendRegistrationStatusRejected(data: {
  full_name: string;
  email: string;
  trip_name: string;
}) {
  const whatsappLink = getWhatsappLink();
  const html = wrapEmail(`
    <h2 style="color: #1B2B3A; margin-top: 0;">An update on your booking</h2>
    <p style="margin: 0 0 16px;">Hi <strong>${escapeHtml(data.full_name)}</strong>,</p>
    <p style="margin: 0 0 16px;">Thank you for your interest in <strong>${escapeHtml(data.trip_name)}</strong>. Unfortunately, we're unable to confirm your spot on this trip.</p>
    <p style="margin: 0 0 16px; color: #6B7280; font-size: 14px;">This can happen due to the trip being fully booked, a payment verification issue, or other circumstances. We're sorry for the inconvenience.</p>
    <div style="background:#FDF0EC;border-radius:8px;padding:16px;margin:0 0 24px;">
      <p style="margin:0;color:#E8725A;font-size:14px;"><strong>What you can do:</strong> Browse our other upcoming trips or contact us on WhatsApp to discuss alternatives.</p>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <a href="${siteUrl('/trips/')}" style="display:inline-block;background:#1B2B3A;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">Browse Other Trips</a>
      <a href="${escapeHtml(whatsappLink)}" style="display:inline-block;background:#25D366;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">WhatsApp Us</a>
    </div>
    <p style="color:#6B7280;font-size:13px;margin:24px 0 0;">If you believe this is a mistake or have questions, please reach out — we'd love to help.</p>
  `);

  await sendEmail(data.email, `Booking Update — ${data.trip_name} | Seek the Thrill`, html, { template: 'registration-rejected' });
}

export async function sendRegistrationCancelled(data: {
  full_name: string;
  email: string;
  trip_name: string;
  trip_date?: string;
  refundKind: 'none' | 'partial' | 'full';
  refundAmount: number;
}) {
  const whatsappLink = getWhatsappLink();
  const refundLine =
    data.refundKind === 'full'
      ? `<p style="margin:0;color:#065F46;font-size:14px;"><strong>Refund:</strong> ₹${Number(data.refundAmount || 0).toLocaleString('en-IN')} has been refunded.</p>`
      : data.refundKind === 'partial'
      ? `<p style="margin:0;color:#065F46;font-size:14px;"><strong>Refund:</strong> A partial refund of ₹${Number(data.refundAmount || 0).toLocaleString('en-IN')} has been processed.</p>`
      : `<p style="margin:0;color:#6B7280;font-size:14px;"><strong>Refund:</strong> No refund is due per the cancellation policy.</p>`;
  const html = wrapEmail(`
    <h2 style="color: #1B2B3A; margin-top: 0;">Your booking has been cancelled</h2>
    <p style="margin: 0 0 16px;">Hi <strong>${escapeHtml(data.full_name)}</strong>,</p>
    <p style="margin: 0 0 16px;">This confirms that your booking for <strong>${escapeHtml(data.trip_name)}</strong>${
      data.trip_date ? ` (${escapeHtml(data.trip_date)})` : ''
    } has been cancelled.</p>
    <div style="background:#F1F5F9;border-radius:8px;padding:16px;margin:0 0 24px;">
      ${refundLine}
    </div>
    <p style="margin: 0 0 16px; color: #6B7280; font-size: 14px;">If you'd like to travel with us another time, browse our upcoming trips or reach out on WhatsApp.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <a href="${siteUrl('/trips/')}" style="display:inline-block;background:#1B2B3A;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">Browse Trips</a>
      <a href="${escapeHtml(whatsappLink)}" style="display:inline-block;background:#25D366;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">WhatsApp Us</a>
    </div>
  `);

  await sendEmail(data.email, `Booking Cancelled — ${data.trip_name} | Seek the Thrill`, html, { template: 'registration-cancelled' });
}

export async function sendRegistrationPaymentReceived(data: {
  firstName: string;
  email: string;
  tripName: string;
  startDate: string;
  endDate: string;
  whatsappLink: string;
}) {
  const html = wrapEmail(`
    <p style="margin: 0 0 16px;">Hi ${escapeHtml(data.firstName)},</p>
    <p style="margin: 0 0 24px;">Your spot on <strong>${escapeHtml(data.tripName)}</strong> is saved.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="border-bottom: 1px solid #F5DDD7;">
        <td style="padding: 10px 8px; color: #6B7280; font-size: 14px;">Trip</td>
        <td style="padding: 10px 8px; font-weight: 600; color: #1B2B3A; font-size: 14px;">${escapeHtml(data.tripName)}</td>
      </tr>
      <tr style="border-bottom: 1px solid #F5DDD7;">
        <td style="padding: 10px 8px; color: #6B7280; font-size: 14px;">Dates</td>
        <td style="padding: 10px 8px; font-weight: 600; color: #1B2B3A; font-size: 14px;">${escapeHtml(data.startDate)} – ${escapeHtml(data.endDate)}</td>
      </tr>
      <tr>
        <td style="padding: 10px 8px; color: #6B7280; font-size: 14px;">Meeting point</td>
        <td style="padding: 10px 8px; color: #1B2B3A; font-size: 14px;">We'll send details closer to the date.</td>
      </tr>
    </table>
    <p style="margin: 0 0 16px; font-size: 14px; color: #1B2B3A;">We've received your payment screenshot and will verify within 24 hours. Once confirmed, you'll get a final email with everything you need to know.</p>
    <p style="margin: 0; font-size: 14px; color: #1B2B3A;">Questions? <a href="${escapeHtml(data.whatsappLink)}" style="color: #E8725A; font-weight: 600;">WhatsApp us.</a></p>
  `);

  await sendEmail(data.email, `You're in! 🎉 ${data.tripName} — spot saved`, html, { template: 'registration-payment-received' });
}

export async function sendRegistrationPaymentPending(data: {
  firstName: string;
  email: string;
  tripName: string;
  startDate: string;
  endDate: string;
  advanceAmount: number;
  whatsappLink: string;
  upiId?: string;
}) {
  const html = wrapEmail(`
    <p style="margin: 0 0 16px;">Hi ${escapeHtml(data.firstName)},</p>
    <p style="margin: 0 0 24px;">We've got your registration for <strong>${escapeHtml(data.tripName)}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr style="border-bottom: 1px solid #F5DDD7;">
        <td style="padding: 10px 8px; color: #6B7280; font-size: 14px;">Trip</td>
        <td style="padding: 10px 8px; font-weight: 600; color: #1B2B3A; font-size: 14px;">${escapeHtml(data.tripName)}</td>
      </tr>
      <tr>
        <td style="padding: 10px 8px; color: #6B7280; font-size: 14px;">Dates</td>
        <td style="padding: 10px 8px; font-weight: 600; color: #1B2B3A; font-size: 14px;">${escapeHtml(data.startDate)} – ${escapeHtml(data.endDate)}</td>
      </tr>
    </table>
    <p style="margin: 0 0 16px; font-size: 14px; color: #1B2B3A; font-weight: 600;">Your spot isn't confirmed yet — we're waiting on your payment.</p>
    <p style="margin: 0 0 8px; font-size: 14px; color: #1B2B3A;">To lock it in:</p>
    <ol style="margin: 0 0 16px; padding-left: 20px; font-size: 14px; color: #1B2B3A; line-height: 1.8;">
      <li>Pay ₹${data.advanceAmount.toLocaleString('en-IN')} via UPI${data.upiId ? ` to <strong>${escapeHtml(data.upiId)}</strong>` : ''}</li>
      <li>Screenshot the payment confirmation</li>
      <li>Reply to this email with the screenshot + transaction ID</li>
    </ol>
    ${data.upiId ? `<p style="margin: 0 0 16px; font-size: 14px; font-family: monospace; font-weight: 700; color: #E8725A;">${escapeHtml(data.upiId)}</p>` : ''}
    <p style="margin: 0 0 16px; font-size: 13px; color: #6B7280;">Spots fill up fast. If you've already paid, ignore this.</p>
    <p style="margin: 0; font-size: 14px; color: #1B2B3A;">Questions? <a href="${escapeHtml(data.whatsappLink)}" style="color: #E8725A; font-weight: 600;">WhatsApp us.</a></p>
  `);

  await sendEmail(data.email, `Almost there — complete your payment for ${data.tripName}`, html, { template: 'registration-payment-pending' });
}

export async function sendNewsletterWelcome(email: string, unsubscribeToken: string) {
  const html = wrapEmail(`
    <p style="margin: 0 0 16px; color: #1B2B3A;">Hi there,</p>
    <p style="margin: 0 0 16px; color: #1B2B3A;">You're now on the Seek the Thrill list.</p>
    <p style="margin: 0 0 24px; color: #1B2B3A;">We won't spam you. You'll hear from us when there's a new trip, a new batch, or something worth knowing.</p>
    <p style="margin: 0 0 32px; color: #1B2B3A;">That's it.</p>
    <p style="margin: 0; font-size: 12px; color: #9CA3AF;"><a href="${siteUrl('/unsubscribe')}?token=${encodeURIComponent(unsubscribeToken)}" style="color: #9CA3AF;">Unsubscribe</a></p>
  `);

  await sendEmail(email, "You're on the list 🏔️", html, { template: 'newsletter-welcome' });
}

export async function sendWishlistOpened(data: {
  firstName: string;
  email: string;
  tripName: string;
  tripSlug: string;
  batchId: string;
  startDate: string;
  endDate: string;
}) {
  const whatsappLink = getWhatsappLink();
  const bookUrl = `${siteUrl(`/trips/${data.tripSlug}/book`)}?batch=${encodeURIComponent(data.batchId)}`;
  const html = wrapEmail(`
    <h2 style="color:#1B2B3A;margin-top:0;">It's open — book your spot</h2>
    <p style="margin:0 0 16px;">Hi ${escapeHtml(data.firstName || 'there')},</p>
    <p style="margin:0 0 16px;">You asked us to tell you the moment <strong>${escapeHtml(data.tripName)}</strong> opened for this departure. It just did:</p>
    <p style="background:#FDF0EC;padding:12px 16px;border-radius:8px;margin:0 0 24px;"><strong>Dates:</strong> ${escapeHtml(data.startDate)} – ${escapeHtml(data.endDate)}</p>
    <p style="margin:0 0 24px;">Spots are first-come, first-served. If you're still keen, book now:</p>
    <p style="margin:0 0 24px;"><a href="${bookUrl}" style="display:inline-block;background:#E8725A;color:white;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Book this date →</a></p>
    <p style="margin:0;font-size:14px;color:#6B7280;">Questions? <a href="${escapeHtml(whatsappLink)}" style="color:#E8725A;font-weight:600;">WhatsApp us.</a></p>
  `);

  await sendEmail(data.email, `Now open: ${data.tripName} (${data.startDate})`, html, { template: 'wishlist-opened' });
}

export async function sendBroadcastToSubscriber(params: {
  email: string;
  firstName: string;
  subject: string;
  bodyHtml: string;
  postUrl: string;
  unsubscribeToken: string;
}) {
  const html = wrapEmail(`
    <p style="margin: 0 0 16px; color: #1B2B3A;">Hi ${escapeHtml(params.firstName)},</p>
    <div style="color: #1B2B3A; line-height: 1.7; margin-bottom: 24px;">${params.bodyHtml}</div>
    ${params.postUrl ? `<p style="margin: 0 0 32px;"><a href="${escapeHtml(params.postUrl)}" style="display: inline-block; background: #E8725A; color: white; padding: 12px 28px; border-radius: 999px; text-decoration: none; font-weight: 600; font-size: 14px;">Read more →</a></p>` : ''}
    <p style="margin: 0; font-size: 12px; color: #9CA3AF;">You're getting this because you signed up at seekthethrill.in.<br><a href="${siteUrl('/unsubscribe')}?token=${encodeURIComponent(params.unsubscribeToken)}" style="color: #9CA3AF;">Unsubscribe</a></p>
  `);

  await sendEmail(params.email, params.subject, html, { template: 'newsletter-broadcast' });
}
