export const prerender = false;
import type { APIRoute } from 'astro';
import { readTrip, writeTrip, listTripSlugs } from '../../../../lib/content';
import { copiedTripName, freshBatchIds, withAdminTripUpdate } from '../../../../lib/tripAdminMetadata';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, tripPaths } from '../../../../lib/cachePurge';
import { logAction } from '../../../../lib/audit';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const { slug } = await request.json();
    if (!slug) {
      return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    }

    const source = readTrip(slug);
    if (!source) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 });
    }

    // Find a unique slug for the copy. Use raw on-disk slugs (incl. soft-deleted)
    // so a copy can't collide with a hidden trip's still-present file.
    const existingSlugs = new Set(listTripSlugs());
    let newSlug = `${slug}-copy`;
    let counter = 2;
    while (existingSlugs.has(newSlug)) {
      newSlug = `${slug}-copy-${counter}`;
      counter++;
    }

    // A copy is a fresh trip — reset booked counts on every departure, both the
    // legacy per-batch count and the new per-offer counts.
    // Copy departures as drafts (and reset bookings) so the duplicate stays
    // hidden until the admin reviews it — trip-level status no longer exists.
    //
    // Each departure also gets its OWN id. Registrations, capacity and costs
    // are keyed by (trip, batch id); a copy that kept its source's ids showed
    // the source's bookings as its own and shared the source's seat count.
    const sourceBatches = Array.isArray(source.batches) ? source.batches : [];
    const newIds = freshBatchIds(newSlug, sourceBatches);
    const copiedBatches = sourceBatches.map((b: any, i: number) => ({
      ...b,
      id: newIds[i],
      status: 'draft',
      bookedSpots: 0,
      // A new date gets its own group; never invite its travellers into the old one.
      whatsappGroupLink: null,
      ...(Array.isArray(b.offers) ? { offers: b.offers.map((o: any) => ({ ...o, booked: 0 })) } : {}),
    }));

    const copiedName = copiedTripName(source, slug);
    const newData: Record<string, any> = withAdminTripUpdate({
      ...source,
      slug: newSlug, // keep the in-YAML slug in sync with the new filename (else the copy collides with the original)
      name: copiedName,
      title: copiedName,
      priority: 'medium',
      batches: copiedBatches,
    });
    delete newData.status; // strip any legacy trip-level status

    writeTrip(newSlug, newData);
    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'trip.duplicate',
      targetType: 'trip',
      targetId: newSlug,
      newValue: { sourceSlug: slug, departures: newIds },
    });

    await submitToIndexNow([`/trips/${newSlug}/`]);
    await purgeUrls(tripPaths(newSlug));
    return new Response(JSON.stringify({ success: true, newSlug }), { status: 200 });
  } catch (err) {
    console.error('Duplicate trip error:', err);
    return new Response(JSON.stringify({ error: 'Failed to duplicate trip' }), { status: 500 });
  }
};
