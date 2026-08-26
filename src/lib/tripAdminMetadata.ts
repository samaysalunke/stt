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
