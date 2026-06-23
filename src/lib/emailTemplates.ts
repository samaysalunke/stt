import { escapeHtml, wrapEmail, sendEmail, ADMIN_EMAIL } from './emailTransport';
import { readSiteSettings } from './settings';

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

  await sendEmail(ADMIN_EMAIL, `New Trip Registration — ${data.trip_name}`, html);
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

  await sendEmail(data.email, `Booking Confirmed — ${data.trip_name} | Seek the Thrill`, html);
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
      <a href="https://seekthethrill.in/trips/" style="display:inline-block;background:#1B2B3A;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">Browse Other Trips</a>
      <a href="${escapeHtml(whatsappLink)}" style="display:inline-block;background:#25D366;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">WhatsApp Us</a>
    </div>
    <p style="color:#6B7280;font-size:13px;margin:24px 0 0;">If you believe this is a mistake or have questions, please reach out — we'd love to help.</p>
  `);

  await sendEmail(data.email, `Booking Update — ${data.trip_name} | Seek the Thrill`, html);
}

export async function sendContactConfirmation(name: string, email: string, message: string) {
  const html = wrapEmail(`
    <p style="margin: 0 0 16px;">Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p style="margin: 0 0 16px;">Thank you for reaching out! We've received your message and will get back to you within <strong>24–48 hours</strong>.</p>
    <div style="background: #FDF0EC; border-radius: 8px; padding: 16px; margin: 0 0 16px;">
      <p style="color: #6B7280; margin: 0 0 8px; font-size: 13px;">Your message:</p>
      <p style="margin: 0; font-style: italic; color: #1B2B3A;">"${escapeHtml(message)}"</p>
    </div>
    <p style="color: #6B7280; font-size: 14px; margin: 0;">In the meantime, browse our <a href="https://seekthethrill.in/trips/" style="color: #E8725A;">upcoming trips</a> or follow us on Instagram <strong>@seekthethrill_</strong>.</p>
  `);

  await sendEmail(email, 'We received your message | Seek the Thrill', html);
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

  await sendEmail(data.email, `You're in! 🎉 ${data.tripName} — spot saved`, html);
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

  await sendEmail(data.email, `Almost there — complete your payment for ${data.tripName}`, html);
}

export async function sendNewsletterWelcome(email: string, unsubscribeToken: string) {
  const html = wrapEmail(`
    <p style="margin: 0 0 16px; color: #1B2B3A;">Hi there,</p>
    <p style="margin: 0 0 16px; color: #1B2B3A;">You're now on the Seek the Thrill list.</p>
    <p style="margin: 0 0 24px; color: #1B2B3A;">We won't spam you. You'll hear from us when there's a new trip, a new batch, or something worth knowing.</p>
    <p style="margin: 0 0 32px; color: #1B2B3A;">That's it.</p>
    <p style="margin: 0; font-size: 12px; color: #9CA3AF;"><a href="https://seekthethrill.in/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}" style="color: #9CA3AF;">Unsubscribe</a></p>
  `);

  await sendEmail(email, "You're on the list 🏔️", html);
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
    <p style="margin: 0; font-size: 12px; color: #9CA3AF;">You're getting this because you signed up at seekthethrill.in.<br><a href="https://seekthethrill.in/unsubscribe?token=${encodeURIComponent(params.unsubscribeToken)}" style="color: #9CA3AF;">Unsubscribe</a></p>
  `);

  await sendEmail(params.email, params.subject, html);
}

export async function sendAdminContactNotification(data: Record<string, any>) {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #1B2B3A; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="color: white; margin: 0;">New Contact Form Submission</h2>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #F5DDD7;">
    <p><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>
    <p><strong>Name:</strong> ${escapeHtml(data.full_name)}</p>
    <p><strong>Email:</strong> <a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></p>
    <p><strong>Phone:</strong> ${escapeHtml(data.phone || '—')}</p>
    <p><strong>Source:</strong> ${escapeHtml(data.source || '—')}</p>
    <p><strong>Message:</strong></p>
    <div style="background: #FDF0EC; padding: 16px; border-radius: 8px;">
      <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(data.message)}</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(ADMIN_EMAIL, `New Contact Form: ${data.subject}`, html);
}
