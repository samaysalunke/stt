export function withAdminTripUpdate(
  data: Record<string, any>,
  now = new Date(),
): Record<string, any> {
  return {
    ...data,
    updatedAt: now.toISOString(),
  };
}

export function copiedTripName(source: Record<string, any>, fallbackSlug: string): string {
  const baseName = String(source.title || source.name || fallbackSlug).trim() || fallbackSlug;
  return `${baseName} (Copy)`;
}

/**
 * Ids for the departures of a duplicated trip: `<new slug>-<start date>`, the
 * same shape update.ts backfills, made unique within the trip. Never the
 * source's ids — a batch id is how a booking finds its departure.
 */
export function freshBatchIds(newSlug: string, batches: Array<Record<string, any>>): string[] {
  const used = new Set<string>();
  return batches.map((b, i) => {
    const base = `${newSlug}-${String(b?.startDate || '').trim() || `departure-${i + 1}`}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}
