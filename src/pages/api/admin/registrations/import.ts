import type { APIRoute } from 'astro';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../../../lib/utils';
import { logAction } from '../../../../lib/audit';
import { parseCsvToObjects, parseGoogleFormsRegistrations } from '../../../../lib/csv';
import { createRegistration, hasActiveRegistration, confirmedCountForTier, tierCapFor, type RegStatus } from '../../../../lib/registrationWrite';
import { resolveSelection, type ResolvedSelection } from './create';

const IMPORT_STATUSES: RegStatus[] = ['lead', 'pending', 'confirmed'];
type RowAction = 'create' | 'skip' | 'error' | 'superseded';
interface PreviewRow { row:number; name:string; email:string; tierId:string; status:string; action:RowAction; reason?:string; input?:Record<string, any>; selection?:ResolvedSelection }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => json({ success:false, error, ...extra }, status);

function analyze(csv:string, tripSlug:string, batchId:string, fallbackTier:string, fallbackStatus:RegStatus) {
  const google = parseGoogleFormsRegistrations(csv);
  const preview: PreviewRow[] = [];
  const raw = google ?? parseCsvToObjects(csv).map((r, i) => ({
    row:i + 1, full_name:sanitizeInput(r.full_name || r.name), email:sanitizeInput(r.email).toLowerCase(), phone:sanitizeInput(r.phone),
    emergency_name:sanitizeInput(r.emergency_name), emergency_phone:sanitizeInput(r.emergency_phone), age:sanitizeInput(r.age), gender:sanitizeInput(r.gender),
    city:sanitizeInput(r.city), instagram:sanitizeInput(r.instagram), why_join:sanitizeInput(r.why_join), tier_id:fallbackTier, status:fallbackStatus,
  }));

  for (const r of raw) {
    const base:PreviewRow = { row:r.row, name:r.full_name || '—', email:r.email || '—', tierId:r.tier_id || '—', status:r.status || '—', action:'create' };
    if ('superseded' in r && r.superseded) { preview.push({ ...base, action:'superseded', reason:`Superseded by row ${r.supersededByRow}` }); continue; }
    if ('error' in r && r.error) { preview.push({ ...base, action:'error', reason:r.error }); continue; }
    if (!r.full_name || !r.email || !r.phone) { preview.push({ ...base, action:'error', reason:'Missing name, email, or phone' }); continue; }
    if (!isValidEmail(r.email)) { preview.push({ ...base, action:'error', reason:'Invalid email' }); continue; }
    if (!isValidPhone(r.phone)) { preview.push({ ...base, action:'error', reason:'Invalid phone' }); continue; }
    const selection = resolveSelection(tripSlug, batchId, r.tier_id);
    if ('error' in selection) { preview.push({ ...base, action:'error', reason:selection.error }); continue; }
    if (hasActiveRegistration(r.email, tripSlug, batchId)) { preview.push({ ...base, action:'skip', reason:'Already imported for these dates' }); continue; }
    preview.push({ ...base, input:r, selection });
  }

  const candidates = preview.filter((p) => p.action === 'create');
  const tiers = [...new Set(candidates.map((p) => p.tierId))];
  const capacity = tiers.map((tierId) => {
    const sample = candidates.find((p) => p.tierId === tierId)!;
    const existing = confirmedCountForTier(batchId, tierId);
    const proposed = candidates.filter((p) => p.tierId === tierId && p.status === 'confirmed').length;
    const cap = tierCapFor(sample.selection!.trip_name, batchId, tierId);
    return { tierId, cap, existingConfirmed:existing, proposedConfirmed:proposed, totalConfirmed:existing + proposed,
      conflict: !sample.selection!.is_past && cap != null && existing + proposed > cap };
  });
  const counts = { create:candidates.length, skip:preview.filter(p=>p.action==='skip').length,
    error:preview.filter(p=>p.action==='error').length, superseded:preview.filter(p=>p.action==='superseded').length };
  const totals = tiers.map((tierId) => ({ tierId, lead:candidates.filter(p=>p.tierId===tierId&&p.status==='lead').length,
    pending:candidates.filter(p=>p.tierId===tierId&&p.status==='pending').length,
    confirmed:candidates.filter(p=>p.tierId===tierId&&p.status==='confirmed').length }));
  return { format:google ? 'google-forms' : 'generic', preview, candidates, counts, totals, capacity, hasCapacityConflict:capacity.some(c=>c.conflict) };
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const tripSlug=sanitizeInput(body.tripSlug), batchId=sanitizeInput(body.batchId), tierId=sanitizeInput(body.tierId);
    const status=sanitizeInput(body.status) as RegStatus, csv=typeof body.csv==='string'?body.csv:'';
    const dryRun=body.dryRun!==false, sendEmail=body.sendEmail===true||body.sendEmail==='true';
    const capacityOverride=body.capacityOverride===true||body.capacityOverride==='true';
    if (!IMPORT_STATUSES.includes(status)) return fail('Pick a valid status (lead, pending, or confirmed).');
    if (!csv.trim()) return fail('Upload or paste a CSV first.');
    if (!tripSlug || !batchId) return fail('Pick a trip and departure.');
    const rows=parseCsvToObjects(csv); if (!rows.length) return fail('No data rows found.'); if (rows.length>500) return fail('Too many rows (max 500 per import).');

    // Analysis is deliberately performed for both preview and commit.
    const result=analyze(csv, tripSlug, batchId, tierId, status);
    if (dryRun) return json({ success:true, dryRun:true, ...result, candidates:undefined });
    if (result.hasCapacityConflict && !capacityOverride) {
      return fail('Import exceeds configured tier capacity. Explicit override is required; no rows were imported.', 409,
        { dryRun:false, preview:result.preview, counts:result.counts, totals:result.totals, capacity:result.capacity, requiresCapacityOverride:true });
    }

    let created=0;
    for (const p of result.candidates) {
      const r=p.input!;
      const inserted=createRegistration({ ...p.selection!, full_name:r.full_name, email:r.email, phone:r.phone,
        age:r.age||null, gender:r.gender||null, city:r.city||null, instagram:r.instagram||null,
        emergency_name:r.emergency_name||null, emergency_phone:r.emergency_phone||null, why_join:r.why_join||null,
        status:r.status, admin_notes:'Imported by admin', created_at:r.created_at||null, consent_at:r.consent_at||null },
        { sendEmail, skipCapacity:p.selection!.is_past || capacityOverride });
      if (!inserted.ok) { p.action=inserted.error==='duplicate'?'skip':'error'; p.reason=inserted.message||'Insert failed'; continue; }
      created++;
    }
    const counts={ create:created, skip:result.preview.filter(p=>p.action==='skip').length,
      error:result.preview.filter(p=>p.action==='error').length, superseded:result.counts.superseded };
    logAction({ actorUserId:locals.adminUser?.userId, actorEmail:locals.adminUser?.email, actorRole:locals.adminUser?.role,
      action:'booking.imported', targetType:'registration', targetId:batchId,
      newValue:{ tripSlug, format:result.format, created, skipped:counts.skip, errors:counts.error, capacityOverride } });
    return json({ success:true, dryRun:false, created, counts, preview:result.preview, totals:result.totals, capacity:result.capacity });
  } catch (err) { console.error('[registrations/import]', err); return fail('Server error.', 500); }
};
