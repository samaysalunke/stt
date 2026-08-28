import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { ensureDocument, type DocumentType } from '../../../../lib/paymentLedger';
import { processZohoDocument, refreshZohoDocumentStatus } from '../../../../lib/zohoBooks';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';

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
