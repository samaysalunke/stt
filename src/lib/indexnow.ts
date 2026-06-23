// IndexNow: notify search engines (Bing, Yandex, et al.) when a public URL is
// created, updated, or removed. See SEO-OPERATIONS.md item 7.
//
// Requires a production key hosted at https://seekthethrill.in/<key>.txt — set
// INDEXNOW_KEY in the production environment. Without it, every call is a no-op,
// so this is safe to leave wired in non-prod and before the key is provisioned.

const SITE = 'https://seekthethrill.in';
const HOST = 'seekthethrill.in';

export const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? '';

/** Absolutize against the canonical origin and de-duplicate. Pure — safe to test. */
export function indexNowUrls(paths: string[]): string[] {
  return [...new Set(
    paths.filter(Boolean).map((p) => (p.startsWith('http') ? p : `${SITE}${p}`)),
  )];
}

/**
 * Submit changed canonical URLs to IndexNow. No-op unless running in production
 * with INDEXNOW_KEY set. Never throws — discovery is best-effort and must not
 * block or fail the admin action that triggered it.
 */
export async function submitToIndexNow(paths: string[]): Promise<void> {
  if (!import.meta.env.PROD || !INDEXNOW_KEY) return;
  const urlList = indexNowUrls(paths);
  if (urlList.length === 0) return;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
    });
  } catch {
    /* best-effort; ignore network/endpoint failures */
  }
}
