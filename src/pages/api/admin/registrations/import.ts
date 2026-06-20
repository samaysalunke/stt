import type { APIRoute } from 'astro';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../../../lib/utils';
import { logAction } from '../../../../lib/audit';
import { parseCsvToObjects } from '../../../../lib/csv';
import {
  createRegistration, hasActiveRegistration, confirmedCountForTier, tierCapFor,
  type RegStatus,
} from '../../../../lib/registrationWrite';
import { resolveSelection } from './create';

const IMPORT_STATUSES: RegStatus[] = ['lead', 'pending', 'confirmed'];

type RowAction = 'create' | 'skip' | 'error';
interface PreviewRow {
  row: number;            // 1-based row number (excluding header)
  name: string;
  email: string;
  action: RowAction;
  reason?: string;
}

const fail = (error: string, status = 400) =>
  new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();

    const tripSlug = sanitizeInput(body.tripSlug);
    const batchId = sanitizeInput(body.batchId);
    const tierId = sanitizeInput(body.tierId);
    const status = sanitizeInput(body.status) as RegStatus;
    const sendEmail = body.sendEmail === true || body.sendEmail === 'true';
    const dryRun = body.dryRun !== false; // default to a safe dry run
    const csv = typeof body.csv === 'string' ? body.csv : '';

    if (!IMPORT_STATUSES.includes(status)) return fail('Pick a valid status (lead, pending, or confirmed).');
    if (!csv.trim()) return fail('Upload or paste a CSV first.');

    const sel = resolveSelection(tripSlug, batchId, tierId);
    if ('error' in sel) return fail(sel.error);

    const rows = parseCsvToObjects(csv);
    if (rows.length === 0) return fail('No data rows found. Include a header row plus at least one registrant.');
    if (rows.length > 500) return fail('Too many rows (max 500 per import).');

    // Capacity budget for confirmed imports — not enforced for historical
    // back-fill (past departures), where we're recording who actually went.
    const cap = (status === 'confirmed' && !sel.is_past)
      ? tierCapFor(sel.trip_name, sel.batch_id, sel.tier_id)
      : null;
    let confirmedSoFar = status === 'confirmed' ? confirmedCountForTier(sel.batch_id, sel.tier_id) : 0;

    const seenEmails = new Set<string>();
    const preview: PreviewRow[] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const full_name = sanitizeInput(r.full_name || r.name);
      const email = sanitizeInput(r.email).toLowerCase();
      const phone = sanitizeInput(r.phone);
      const base: PreviewRow = { row: i + 1, name: full_name || '—', email: email || '—', action: 'create' };

      // ── Validation ────────────────────────────────────────────────────────
      if (!full_name || !email || !phone) {
        preview.push({ ...base, action: 'error', reason: 'Missing name, email, or phone' });
        continue;
      }
      if (!isValidEmail(email)) { preview.push({ ...base, action: 'error', reason: 'Invalid email' }); continue; }
      if (!isValidPhone(phone)) { preview.push({ ...base, action: 'error', reason: 'Invalid phone' }); continue; }

      // ── Duplicate (within the file, or already active in DB) ───────────────
      if (seenEmails.has(email)) { preview.push({ ...base, action: 'skip', reason: 'Duplicate in file' }); continue; }
      if (hasActiveRegistration(email, sel.trip_slug, sel.batch_id)) {
        preview.push({ ...base, action: 'skip', reason: 'Already registered for these dates' });
        continue;
      }

      // ── Capacity (confirmed only) ─────────────────────────────────────────
      if (cap != null && confirmedSoFar >= cap) {
        preview.push({ ...base, action: 'error', reason: `Tier full (${confirmedSoFar}/${cap})` });
        continue;
      }

      seenEmails.add(email);

      if (!dryRun) {
        // Each confirmed insert bumps the live tier count that createRegistration
        // re-checks, so no extra reservation bookkeeping is needed here.
        const result = createRegistration(
          {
            ...sel,
            full_name, email, phone,
            age: sanitizeInput(r.age) || null,
            gender: sanitizeInput(r.gender) || null,
            city: sanitizeInput(r.city) || null,
            instagram: sanitizeInput(r.instagram) || null,
            emergency_name: sanitizeInput(r.emergency_name) || null,
            emergency_phone: sanitizeInput(r.emergency_phone) || null,
            why_join: sanitizeInput(r.why_join) || null,
            status,
            admin_notes: 'Imported by admin',
          },
          { sendEmail, skipCapacity: sel.is_past },
        );
        if (!result.ok) {
          preview.push({ ...base, action: 'error', reason: result.message ?? 'Insert failed' });
          seenEmails.delete(email);
          continue;
        }
        created++;
      }

      if (status === 'confirmed') confirmedSoFar++;
      preview.push(base);
    }

    const counts = {
      create: preview.filter((p) => p.action === 'create').length,
      skip: preview.filter((p) => p.action === 'skip').length,
      error: preview.filter((p) => p.action === 'error').length,
    };

    if (dryRun) {
      return new Response(JSON.stringify({ success: true, dryRun: true, preview, counts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'booking.imported',
      targetType: 'registration',
      targetId: sel.batch_id,
      newValue: { trip: sel.trip_name, status, created, skipped: counts.skip, errors: counts.error },
    });

    return new Response(JSON.stringify({ success: true, dryRun: false, created, counts, preview }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[registrations/import]', err);
    return fail('Server error.', 500);
  }
};
