import { sendRegistrationPaymentConfirmed } from './email';
import { getDb } from './db';
import { billingProblems } from './paymentLedger';

const env = (key: string) => (import.meta.env as any)[key] || process.env[key];
const dc = () => {
  const value = String(env('ZOHO_DATA_CENTER') || 'in').toLowerCase();
  return ['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'].includes(value) ? value : 'in';
};
const apiOrigin = () => `https://www.zohoapis.${dc()}`;
const accountsOrigin = () => `https://accounts.zoho.${dc()}`;
const organizationId = () => String(env('ZOHO_BOOKS_ORGANIZATION_ID') || '');

let accessToken = '';
let accessTokenExpiresAt = 0;

export function zohoConfigured(): boolean {
  return ['ZOHO_BOOKS_ORGANIZATION_ID', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_BOOKS_ITEM_ID']
    .every((key) => Boolean(env(key)));
}

function cleanError(value: unknown): string {
  return String(value instanceof Error ? value.message : value)
    .replace(/(token|secret|authorization|password)(["'\s:=]+)[^\s,"'}]+/gi, '$1$2[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 700);
}

async function token(): Promise<string> {
  if (accessToken && accessTokenExpiresAt > Date.now() + 60_000) return accessToken;
  const body = new URLSearchParams({
    refresh_token: String(env('ZOHO_REFRESH_TOKEN') || ''),
    client_id: String(env('ZOHO_CLIENT_ID') || ''),
    client_secret: String(env('ZOHO_CLIENT_SECRET') || ''),
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${accountsOrigin()}/oauth/v2/token`, { method: 'POST', body, signal: AbortSignal.timeout(15_000) });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`Zoho OAuth failed (${response.status}): ${result.error || 'unknown error'}`);
  accessToken = result.access_token;
  accessTokenExpiresAt = Date.now() + (Number(result.expires_in) || 3600) * 1000;
  return accessToken;
}

async function request(path: string, init: RequestInit = {}, pdf = false): Promise<any> {
  if (!organizationId()) throw new Error('ZOHO_BOOKS_ORGANIZATION_ID is not configured');
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`${apiOrigin()}/books/v3${path}${separator}organization_id=${encodeURIComponent(organizationId())}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${await token()}`,
      Accept: pdf ? 'application/pdf' : 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Zoho Books failed (${response.status}): ${cleanError(detail)}`);
  }
  if (pdf) return Buffer.from(await response.arrayBuffer());
  const result: any = await response.json();
  if (result?.code && result.code !== 0) throw new Error(`Zoho Books: ${cleanError(result.message || result.code)}`);
  return result;
}

const isoDate = (value: string) => new Date(value).toISOString().slice(0, 10);

async function findContactByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const listed = await request(`/contacts?email=${encodeURIComponent(email)}`);
  const match = (listed.contacts || []).find((c: any) =>
    String(c.email || '').toLowerCase() === email.toLowerCase());
  return match?.contact_id || null;
}

async function findContactByName(name: string): Promise<string | null> {
  if (!name) return null;
  const listed = await request(`/contacts?contact_name_contains=${encodeURIComponent(name)}`);
  const match = (listed.contacts || []).find((c: any) =>
    String(c.contact_name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return match?.contact_id || null;
}

async function findOrCreateCustomer(snapshot: any, registrationId: number): Promise<string> {
  // Zoho enforces a unique contact_name, so an existing contact whose email
  // doesn't match ours (created manually, or with a different address) would
  // otherwise collide on create. Check both, and recover by name on 3062.
  const byEmail = await findContactByEmail(snapshot.email);
  if (byEmail) return byEmail;
  const byName = await findContactByName(snapshot.customerName);
  if (byName) return byName;

  const billingAddress = {
    address: snapshot.address || undefined,
    city: snapshot.city || undefined,
    state: snapshot.state || undefined,
    zip: snapshot.pincode || undefined,
    country: snapshot.country || 'India',
  };
  try {
    const created = await request('/contacts', {
      method: 'POST',
      body: JSON.stringify({
        contact_name: snapshot.customerName,
        company_name: snapshot.business ? snapshot.customerName : undefined,
        contact_type: 'customer',
        email: snapshot.email,
        phone: snapshot.phone,
        billing_address: billingAddress,
        notes: `STT customer; first linked registration #${registrationId}`,
      }),
    });
    const id = created.contact?.contact_id;
    if (!id) throw new Error('Zoho customer creation returned no customer ID');
    return id;
  } catch (err: any) {
    if (/already exists|"code"\s*:\s*3062/i.test(String(err?.message || ''))) {
      const reuse = await findContactByName(snapshot.customerName);
      if (reuse) return reuse;
    }
    throw err;
  }
}

async function findDocument(reference: string): Promise<any | null> {
  const result = await request(`/invoices?reference_number=${encodeURIComponent(reference)}`);
  return (result.invoices || []).find((row: any) => row.reference_number === reference) || null;
}

async function createDocument(customerId: string, snapshot: any, reference: string, amount: number) {
  const baseNotes = `Invoice for ${snapshot.tripName} (${snapshot.tripDate}) · STT registration #${snapshot.registrationId}`;
  const created = await request('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: customerId,
      reference_number: reference,
      date: new Date().toISOString().slice(0, 10),
      template_id: env('ZOHO_INVOICE_TEMPLATE_ID') || undefined,
      notes: baseNotes,
      line_items: [{
        item_id: String(env('ZOHO_BOOKS_ITEM_ID')),
        name: snapshot.tripName,
        description: `${snapshot.tripName} · ${snapshot.tripDate}`,
        rate: amount,
        quantity: 1,
      }],
    }),
  });
  return created.invoice;
}

function assertZeroTax(document: any) {
  const taxTotal = Number(document?.tax_total || 0);
  const listedTax = Array.isArray(document?.taxes)
    ? document.taxes.reduce((sum: number, row: any) => sum + Number(row?.tax_amount || 0), 0)
    : 0;
  const listedTaxRow = Array.isArray(document?.taxes)
    && document.taxes.some((row: any) => Boolean(row?.tax_id || row?.tax_name) || Number(row?.tax_amount || 0) !== 0);
  const taxedLine = Array.isArray(document?.line_items)
    && document.line_items.some((row: any) => Boolean(row?.tax_id || row?.tax_name) || Number(row?.tax_percentage || 0) !== 0 || Number(row?.tax_amount || 0) !== 0);
  if (Math.abs(taxTotal) > 0.01 || Math.abs(listedTax) > 0.01 || listedTaxRow || taxedLine) {
    throw new Error('Zoho applied tax to this document; configure ZOHO_BOOKS_ITEM_ID as non-taxable before retrying');
  }
}

// Our ledger's payment_method values → Zoho's accepted payment_mode values.
const ZOHO_PAYMENT_MODE: Record<string, string> = {
  upi: 'banktransfer', bank_transfer: 'banktransfer', cash: 'cash',
  card: 'creditcard', cheque: 'check', other: 'others',
};

async function recordInvoicePayment(customerId: string, invoiceId: string, amount: number, event: any) {
  if (amount <= 0) return null;
  const reference = event.transaction_reference || event.id;
  const existing = await request(`/customerpayments?reference_number=${encodeURIComponent(reference)}`);
  const found = (existing.customer_payments || []).find((payment: any) => payment.reference_number === reference);
  if (found) return { payment: found };
  return request('/customerpayments', {
    method: 'POST',
    body: JSON.stringify({
      customer_id: customerId,
      payment_mode: ZOHO_PAYMENT_MODE[String(event.payment_method || '')] || 'banktransfer',
      amount,
      date: isoDate(event.received_at),
      reference_number: reference,
      invoices: [{ invoice_id: invoiceId, amount_applied: amount }],
    }),
  });
}

async function downloadPdf(invoiceId: string): Promise<Buffer> {
  return request(`/invoices/${invoiceId}`, { headers: { Accept: 'application/pdf' } }, true);
}

/** Process one job. Safe to call repeatedly: creation is recovered by reference. */
export async function processZohoDocument(documentId: string) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId) as any;
  if (!job) throw new Error('Document job not found');
  if (['emailed', 'disabled'].includes(job.status)) return job;
  // Legacy advance/retainer jobs are no longer issued — retire them quietly so
  // the retry cron stops hitting the paid-plan retainer endpoints.
  if (job.document_type === 'advance') {
    db.prepare("UPDATE invoice_documents SET status='disabled', last_error='Advance receipts are no longer issued.', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(documentId);
    return db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId);
  }
  const claimed = db.prepare(`
    UPDATE invoice_documents
    SET status='processing', attempts=attempts+1, last_error=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND (status!='processing' OR updated_at < datetime('now','-5 minutes'))
  `).run(documentId);
  if (!claimed.changes) return job;
  try {
    if (!zohoConfigured()) throw new Error('Zoho Books credentials are incomplete');
    const current = db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId) as any;
    const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(current.registration_id) as any;
    const event = current.payment_event_id
      ? db.prepare('SELECT * FROM payment_events WHERE id=?').get(current.payment_event_id) as any
      : db.prepare('SELECT * FROM payment_events WHERE registration_id=? ORDER BY created_at DESC LIMIT 1').get(current.registration_id) as any;
    const snapshot = JSON.parse(current.billing_snapshot);
    const problems = billingProblems(snapshot);
    if (problems.length) throw new Error(`Missing ${problems.join(', ')}`);
    if (!event) throw new Error('No payment event is linked to this document');

    const customerId = current.zoho_customer_id || await findOrCreateCustomer(snapshot, current.registration_id);
    let zohoDoc = current.zoho_document_id ? null : await findDocument(current.external_reference);
    if (!current.zoho_document_id && !zohoDoc) {
      zohoDoc = await createDocument(customerId, snapshot, current.external_reference, Number(snapshot.totalAmount));
    }
    const zohoId = current.zoho_document_id || zohoDoc?.invoice_id;
    const number = current.zoho_document_number || zohoDoc?.invoice_number || current.external_reference;
    if (!zohoId) throw new Error('Zoho invoice returned no ID');
    db.prepare(`UPDATE invoice_documents SET zoho_customer_id=?, zoho_document_id=?, zoho_document_number=?, zoho_status=?, issued_at=COALESCE(issued_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(customerId, zohoId, number, zohoDoc?.status || current.zoho_status || 'draft', documentId);

    const fullDocument = await request(`/invoices/${zohoId}`);
    assertZeroTax(fullDocument.invoice);

    if (current.mode === 'draft') {
      // Draft mode never touches Zoho payments, but the customer still gets our
      // branded confirmation — just without the (undrafted) PDF.
      const draftReg = db.prepare('SELECT * FROM registrations WHERE id=?').get(current.registration_id) as any;
      const draftTotal = Number(draftReg?.total_amount ?? snapshot.totalAmount) || 0;
      const draftPaid = Number(draftReg?.amount_paid) || 0;
      await sendRegistrationPaymentConfirmed({
        full_name: reg.full_name,
        email: reg.email,
        trip_name: reg.trip_name,
        trip_date: reg.trip_date || '',
        kind: 'full',
        amountPaid: draftPaid,
        totalAmount: draftTotal,
        balanceDue: Math.max(0, draftTotal - draftPaid),
      }).catch((err) => console.error('[Zoho draft email]', cleanError(err)));
      db.prepare("UPDATE invoice_documents SET status='draft', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(documentId);
      return db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId);
    }

    // One invoice for the whole trip, paid in full in one customer payment
    // (no retainer to apply). Idempotent on the payment event's reference.
    if (!current.balance_recorded_at) {
      const paymentResult = await recordInvoicePayment(customerId, zohoId, Number(snapshot.totalAmount), event);
      db.prepare('UPDATE invoice_documents SET balance_recorded_at=CURRENT_TIMESTAMP, zoho_payment_id=COALESCE(?,zoho_payment_id), updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(paymentResult?.payment?.payment_id || null, documentId);
    }
    const verified = await request(`/invoices/${zohoId}`);
    const balance = Number(verified.invoice?.balance);
    if (!Number.isFinite(balance) || Math.abs(balance) > 0.01) throw new Error(`Zoho invoice still has a balance of ${Number.isFinite(balance) ? balance : 'unknown'}`);

    const pdf = await downloadPdf(zohoId);
    if (pdf.byteLength > 20 * 1024 * 1024) throw new Error('Zoho PDF exceeds the 20 MB email attachment safety limit');
    const paidReg = db.prepare('SELECT * FROM registrations WHERE id=?').get(current.registration_id) as any;
    const paidTotal = Number(paidReg?.total_amount ?? snapshot.totalAmount) || 0;
    const paidAmount = Number(paidReg?.amount_paid) || 0;
    await sendRegistrationPaymentConfirmed({
      full_name: reg.full_name,
      email: reg.email,
      trip_name: reg.trip_name,
      trip_date: reg.trip_date || '',
      kind: 'full',
      amountPaid: paidAmount,
      totalAmount: paidTotal,
      balanceDue: Math.max(0, paidTotal - paidAmount),
      attachment: { filename: `${number}.pdf`, content: pdf.toString('base64'), contentType: 'application/pdf' },
    });
    db.prepare("UPDATE invoice_documents SET status='emailed', zoho_status='paid', sent_at=CURRENT_TIMESTAMP, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(documentId);
    return db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId);
  } catch (error) {
    const message = cleanError(error);
    const delayMinutes = Math.min(60, 2 ** Math.min(5, Number(job.attempts || 0) + 1));
    db.prepare("UPDATE invoice_documents SET status='failed', last_error=?, next_attempt_at=datetime('now', ?), updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(message, `+${delayMinutes} minutes`, documentId);
    const failed = db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId) as any;
    if (failed.mode === 'live' && Number(failed.attempts) >= 3 && !failed.sent_at) {
      const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(failed.registration_id) as any;
      try {
        const fbTotal = Number(reg?.total_amount) || 0;
        const fbPaid = Number(reg?.amount_paid) || 0;
        await sendRegistrationPaymentConfirmed({
          full_name: reg.full_name,
          email: reg.email,
          trip_name: reg.trip_name,
          trip_date: reg.trip_date || '',
          kind: 'full',
          amountPaid: fbPaid,
          totalAmount: fbTotal,
          balanceDue: Math.max(0, fbTotal - fbPaid),
        });
        db.prepare('UPDATE invoice_documents SET sent_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(documentId);
      } catch (fallbackError) {
        console.error('[Zoho fallback email]', cleanError(fallbackError));
      }
    }
    throw new Error(message);
  }
}

export function zohoOpenUrl(document: any): string | null {
  if (!document?.zoho_document_id || !organizationId()) return null;
  const section = document.document_type === 'advance' ? 'retainerinvoices' : 'invoices';
  return `https://books.zoho.${dc()}/app/${organizationId()}#/${section}/${document.zoho_document_id}`;
}

export async function refreshZohoDocumentStatus(documentId: string) {
  const db = getDb();
  const document = db.prepare('SELECT * FROM invoice_documents WHERE id=?').get(documentId) as any;
  if (!document?.zoho_document_id) throw new Error('This document has not been created in Zoho');
  const path = document.document_type === 'advance' ? `/retainerinvoices/${document.zoho_document_id}` : `/invoices/${document.zoho_document_id}`;
  const result = await request(path);
  const zohoDocument = document.document_type === 'advance' ? result.retainerinvoice : result.invoice;
  db.prepare('UPDATE invoice_documents SET zoho_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(zohoDocument?.status || 'unknown', documentId);
  return zohoDocument?.status || 'unknown';
}
