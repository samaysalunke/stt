import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

const SMTP_HOST = import.meta.env.SMTP_HOST || process.env.SMTP_HOST;
const SMTP_PORT = parseInt(import.meta.env.SMTP_PORT || process.env.SMTP_PORT || '587');
const SMTP_USER = import.meta.env.SMTP_USER || process.env.SMTP_USER;
const SMTP_PASS = import.meta.env.SMTP_PASS || process.env.SMTP_PASS;
const ADMIN_EMAIL = import.meta.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'zahra@seekthethrill.in';

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[Email] SMTP not configured — emails will be logged to console only.');
    return null;
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmail(to: string, subject: string, html: string, from?: string) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[Email Mock] To: ${to}\nSubject: ${subject}\n`);
    return;
  }
  await transporter.sendMail({
    from: from ?? `"Seek the Thrill" <${SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

export async function sendRegistrationConfirmation(data: {
  name: string;
  email: string;
  tripName: string;
  tripDate: string;
  duration: string;
}) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Registration Confirmed</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f7;">
  <div style="background: #1A3D28; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Seek the Thrill 🏔️</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">Adventure Awaits</p>
  </div>
  <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
    <h2 style="color: #2D5F3E; margin-top: 0;">Registration Confirmed! 🎉</h2>
    <p>Hi <strong>${data.name}</strong>,</p>
    <p>Thank you for registering for <strong>${data.tripName}</strong>! We've received your registration and payment details.</p>
    <div style="background: #E8F5EC; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h3 style="color: #2D5F3E; margin-top: 0;">What happens next:</h3>
      <ul style="color: #333; padding-left: 20px;">
        <li>Our team will review your submission within 24 hours</li>
        <li>You'll receive a booking confirmation email</li>
        <li>We'll send you a trip preparation guide</li>
        <li>You'll be added to the trip WhatsApp group</li>
        <li>Pre-trip briefing details will be shared</li>
      </ul>
    </div>
    <div style="border-top: 2px solid #E5E5E0; padding-top: 20px; margin-top: 20px;">
      <h3 style="color: #2D5F3E;">Your Registration Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; color: #666;">Trip</td><td style="padding: 8px; font-weight: bold;">${data.tripName}</td></tr>
        <tr style="background: #f9f9f7;"><td style="padding: 8px; color: #666;">Dates</td><td style="padding: 8px; font-weight: bold;">${data.tripDate}</td></tr>
        <tr><td style="padding: 8px; color: #666;">Duration</td><td style="padding: 8px; font-weight: bold;">${data.duration}</td></tr>
      </table>
    </div>
    <p style="color: #666; font-size: 14px;">Have questions? Reply to this email or <a href="https://wa.me/917975027491" style="color: #e07b39; font-weight: bold;">WhatsApp us at +91-7975027491</a>.</p>
    <div style="background: #1A3D28; border-radius: 8px; padding: 20px; margin-top: 20px; text-align: center;">
      <p style="color: white; margin: 0; font-size: 18px; font-style: italic;">Adventure awaits! 🌄</p>
      <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 13px;">Team Seek the Thrill | seekthethrill.in | +91-7975027491</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(
    data.email,
    `Registration Confirmed - ${data.tripName} | Seek the Thrill`,
    html
  );
}

export async function sendAdminRegistrationNotification(data: Record<string, any>) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #E8752A; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="color: white; margin: 0;">🔔 New Trip Registration</h2>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #E5E5E0;">
    <h3 style="color: #2D5F3E; margin-top: 0;">Trip: ${data.trip_name}</h3>
    <table style="width: 100%; border-collapse: collapse;">
      ${Object.entries(data).map(([k, v]) =>
        `<tr style="border-bottom: 1px solid #f0f0f0;">
          <td style="padding: 8px; color: #666; width: 40%; text-transform: capitalize;">${k.replace(/_/g, ' ')}</td>
          <td style="padding: 8px; font-weight: 500;">${v ?? '—'}</td>
        </tr>`
      ).join('')}
    </table>
  </div>
</body>
</html>`;

  await sendEmail(
    ADMIN_EMAIL,
    `🔔 New Trip Registration - ${data.trip_name}`,
    html
  );
}

export async function sendRegistrationStatusConfirmed(data: {
  full_name: string;
  email: string;
  trip_name: string;
  trip_date?: string;
}) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Booking Confirmed!</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f7;">
  <div style="background: #1A3D28; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Seek the Thrill 🏔️</h1>
  </div>
  <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
    <h2 style="color: #2D5F3E; margin-top: 0;">🎉 Your booking is confirmed!</h2>
    <p>Hi <strong>${data.full_name}</strong>,</p>
    <p>Great news — your booking for <strong>${data.trip_name}</strong> has been <strong style="color:#2D5F3E;">confirmed</strong>! We're thrilled to have you on board.</p>
    ${data.trip_date ? `<p style="background:#E8F5EC;padding:12px 16px;border-radius:8px;"><strong>Trip Date:</strong> ${data.trip_date}</p>` : ''}
    <div style="background:#E8F5EC;border-radius:8px;padding:20px;margin:20px 0;">
      <h3 style="color:#2D5F3E;margin-top:0;">What happens next:</h3>
      <ul style="color:#333;padding-left:20px;">
        <li>You'll receive a detailed trip preparation guide shortly</li>
        <li>You'll be added to the trip WhatsApp group</li>
        <li>Pre-trip briefing details will be shared a few days before departure</li>
        <li>Ensure your remaining balance is paid before departure</li>
      </ul>
    </div>
    <p style="color:#666;font-size:14px;">Questions? <a href="https://wa.me/917975027491" style="color:#E8752A;font-weight:bold;">WhatsApp us at +91-7975027491</a> or reply to this email.</p>
    <div style="background:#1A3D28;border-radius:8px;padding:20px;margin-top:20px;text-align:center;">
      <p style="color:white;margin:0;font-size:18px;font-style:italic;">Adventure awaits! 🌄</p>
      <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:13px;">Team Seek the Thrill | +91-7975027491</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(
    data.email,
    `🎉 Booking Confirmed — ${data.trip_name} | Seek the Thrill`,
    html
  );
}

export async function sendRegistrationStatusRejected(data: {
  full_name: string;
  email: string;
  trip_name: string;
}) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Booking Update</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f7;">
  <div style="background: #1A3D28; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Seek the Thrill 🏔️</h1>
  </div>
  <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
    <h2 style="color: #333; margin-top: 0;">An update on your booking</h2>
    <p>Hi <strong>${data.full_name}</strong>,</p>
    <p>Thank you for your interest in <strong>${data.trip_name}</strong>. Unfortunately, we're unable to confirm your spot on this trip.</p>
    <p>This can happen due to the trip being fully booked, a payment verification issue, or other circumstances. We're sorry for the inconvenience.</p>
    <div style="background:#FEF3C7;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0;color:#92400E;"><strong>What you can do:</strong> Browse our other upcoming trips or contact us on WhatsApp to discuss alternatives.</p>
    </div>
    <div style="display:flex;gap:12px;margin-top:20px;">
      <a href="https://seekthethrill.in/trips/" style="display:inline-block;background:#1A3D28;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Browse Other Trips</a>
      <a href="https://wa.me/917975027491" style="display:inline-block;background:#25D366;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">WhatsApp Us</a>
    </div>
    <p style="color:#666;font-size:13px;margin-top:24px;">If you believe this is a mistake or have questions, please reach out — we'd love to help.</p>
    <p style="color:#666;font-size:13px;">Team Seek the Thrill | +91-7975027491</p>
  </div>
</body>
</html>`;

  await sendEmail(
    data.email,
    `Booking Update — ${data.trip_name} | Seek the Thrill`,
    html
  );
}

export async function sendContactConfirmation(name: string, email: string, message: string) {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #1A3D28; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h2 style="color: white; margin: 0;">Seek the Thrill 🏔️</h2>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #E5E5E0;">
    <p>Hi <strong>${name}</strong>,</p>
    <p>Thank you for reaching out! We've received your message and will get back to you within <strong>24-48 hours</strong>.</p>
    <div style="background: #f9f9f7; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="color: #666; margin: 0 0 8px; font-size: 13px;">Your message:</p>
      <p style="margin: 0; font-style: italic;">"${message}"</p>
    </div>
    <p style="color: #666; font-size: 14px;">In the meantime: browse our <a href="https://seekthethrill.in/trips/" style="color: #E8752A;">upcoming trips</a> or follow us on Instagram <strong>@seekthethrill</strong>.</p>
    <p style="color: #666; font-size: 14px;">Adventure awaits! 🌄<br><strong>Team Seek the Thrill</strong></p>
  </div>
</body>
</html>`;

  await sendEmail(email, 'We received your message | Seek the Thrill', html);
}

export async function sendAdminContactNotification(data: Record<string, any>) {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #2D5F3E; padding: 20px; border-radius: 8px 8px 0 0;">
    <h2 style="color: white; margin: 0;">New Contact Form Submission</h2>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #E5E5E0;">
    <p><strong>Subject:</strong> ${data.subject}</p>
    <p><strong>Name:</strong> ${data.full_name}</p>
    <p><strong>Email:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
    <p><strong>Phone:</strong> ${data.phone || '—'}</p>
    <p><strong>Source:</strong> ${data.source || '—'}</p>
    <p><strong>Message:</strong></p>
    <div style="background: #f9f9f7; padding: 16px; border-radius: 8px;">
      <p style="margin: 0; white-space: pre-wrap;">${data.message}</p>
    </div>
  </div>
</body>
</html>`;

  await sendEmail(
    ADMIN_EMAIL,
    `New Contact Form: ${data.subject}`,
    html
  );
}
