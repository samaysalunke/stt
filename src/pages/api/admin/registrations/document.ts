import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { ensureDocument, type DocumentType } from '../../../../lib/paymentLedger';
import { fetchDocumentPdf, processZohoDocument, refreshZohoDocumentStatus } from '../../../../lib/zohoBooks';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';

/**
 * Download the issued PDF for one booking's invoice.
 *
 * A GET so the admin UI can be a plain `<a download>` — the session is a
 * cookie and the request is same-origin, so there is no handler to write. It
 * only ever reads: pulling a copy never re-queues or re-sends the document.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const registrationId = Number(url.searchParams.get('registrationId'));
  const type = String(url.searchParams.get('type') || 'final') as DocumentType;
  if (!Number.isInteger(registrationId) || registrationId <= 0 || !['advance', 'final'].includes(type)) {
    return jsonFail('Invalid document request.');
  }
  const document = getDb()
    .prepare('SELECT id, zoho_document_id FROM invoice_documents WHERE registration_id=? AND document_type=?')
    .get(registrationId, type) as any;
  if (!document) return jsonFail('No document exists for this registration.', 404);
  if (!document.zoho_document_id) return jsonFail('This invoice has not been issued in Zoho yet.', 404);

  try {
    const { pdf, filename } = await fetchDocumentPdf(document.id);
    logAction({
      actorUserId: locals.adminUser?.userId, actorEmail: locals.adminUser?.email, actorRole: locals.adminUser?.role,
      action: 'accounting_document.downloaded', targetType: 'registration', targetId: String(registrationId),
      newValue: { type, documentId: document.id },
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    // Zoho was unreachable, slow (its 25s timeout) or refused. Say so plainly
    // rather than handing the browser a broken download.
    console.error('[document download]', error);
    return jsonFail(`Could not fetch the invoice from Zoho: ${String(error?.message || error)}`, 502);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const body = await request.json();
    const registrationId = Number(body.registrationId);
    const type = String(body.type || '') as DocumentType;
    const action = String(body.action || 'retry');
    if (!Number.isInteger(registrationId) || registrationId <= 0 || !['advance', 'final'].includes(type) || !['retry', 'generate', 'refresh'].includes(action)) {
      return jsonFail('Invalid document request.');
    }
    // Advance/retainer invoices are no longer issued; only legacy rows can be
    // retried (they self-retire) or refreshed. Generation is final-invoice only.
    if (action === 'generate' && type !== 'final') {
      return jsonFail('Only the final invoice can be generated — it needs the booking to be fully paid.');
    }
    if (action === 'refresh') {
      const existing = getDb().prepare('SELECT id FROM invoice_documents WHERE registration_id=? AND document_type=?').get(registrationId, type) as any;
      if (!existing) return jsonFail('No document exists for this registration.', 404);
      const status = await refreshZohoDocumentStatus(existing.id);
      return jsonOk({ success: true, status });
    }
    let document: any;
    if (action === 'generate') {
      document = ensureDocument(registrationId, type);
      if (!document) return jsonFail('Zoho Books integration is disabled.');
    } else {
      document = getDb().prepare('SELECT * FROM invoice_documents WHERE registration_id=? AND document_type=?').get(registrationId, type) as any;
      if (!document) return jsonFail('No document job exists for this registration.', 404);
      const staleProcessing = document.status === 'processing' && Date.parse(`${document.updated_at}Z`) < Date.now() - 5 * 60_000;
      if (!['failed', 'queued', 'draft'].includes(document.status) && !staleProcessing) return jsonFail('This document is not retryable in its current state.');
      getDb().prepare("UPDATE invoice_documents SET status='queued', next_attempt_at=NULL, last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(document.id);
    }
    void processZohoDocument(document.id).catch((error) => console.error('[Zoho retry]', error));
    logAction({
      actorUserId: locals.adminUser?.userId, actorEmail: locals.adminUser?.email, actorRole: locals.adminUser?.role,
      action: `accounting_document.${action}`, targetType: 'registration', targetId: String(registrationId),
      newValue: { type, documentId: document.id },
    });
    return jsonOk({ success: true, documentId: document.id, status: 'queued' });
  } catch (error: any) {
    return jsonFail(String(error?.message || error), 400);
  }
};
