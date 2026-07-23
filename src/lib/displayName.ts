import { getDb } from './db';

export function validateDisplayName(name: string): string | null {
  if (!name) return 'Display name is required.';
  if (name.length > 50) return 'Display name must be 50 characters or fewer.';
  return null;
}

export function setDisplayName(
  userId: string,
  name: string
): { success: boolean; error?: string } {
  const trimmed = name.trim();
  const err = validateDisplayName(trimmed);
  if (err) return { success: false, error: err };

  const db = getDb();
  db.prepare('UPDATE users SET displayName = ?, displayNameOverride = 1 WHERE id = ?').run(
    trimmed,
    userId,
  );

  return { success: true };
}
