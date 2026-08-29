import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

// Admin-uploaded images live in CONTENT_DIR/images/ (volume-backed).
// Seed/repo images live in public/images/. Check volume first.
const CONTENT_IMAGES = path.join(
  process.env.CONTENT_DIR ?? path.join(process.cwd(), 'src', 'content'),
  'images'
);
const PUBLIC_IMAGES = path.join(process.cwd(), 'public', 'images');

/**
 * Caching contract for user-uploaded images.
 *
 * These URLs are NOT content-addressed. saveImageFile() only generates a UUID
 * filename when no name part is supplied, and four admin paths supply a
 * deterministic one — `<slug>-featured` for a trip cover and `<slug>-cover` for
 * an album cover. Re-uploading therefore overwrites the same URL.
 *
 * The route used to send `max-age=31536000, immutable` on those, which tells
 * every browser that already has the old file never to revalidate, for a year.
 * No purge can fix a browser cache, so replacing a trip's cover image was
 * effectively invisible to anyone who had seen the old one.
 *
 * So the two audiences get different instructions: browsers revalidate daily
 * and get a cheap 304 (hence the validators below), while Cloudflare — which we
 * can purge explicitly, and do, at each overwrite site — keeps its year.
 */
const BROWSER_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';
const EDGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Weak validator: size + mtime is enough to detect a replaced file. */
function weakETag(stat: fs.Stats): string {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/** One stat call answers existence, file-ness, size and mtime together. */
function statFile(filePath: string): fs.Stats | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ params, request }) => {
  const rel = params.path ?? '';

  // Prevent path traversal
  if (rel.includes('..')) {
    return new Response('Forbidden', { status: 403 });
  }

  // Look in volume first, then repo
  let filePath = path.join(CONTENT_IMAGES, rel);
  let stat = statFile(filePath);
  if (!stat) {
    filePath = path.join(PUBLIC_IMAGES, rel);
    stat = statFile(filePath);
  }

  // Final traversal guard after path.join resolves
  const inContent = filePath.startsWith(CONTENT_IMAGES + path.sep) || filePath === CONTENT_IMAGES;
  const inPublic = filePath.startsWith(PUBLIC_IMAGES + path.sep) || filePath === PUBLIC_IMAGES;
  if (!inContent && !inPublic) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!stat) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const etag = weakETag(stat);
  const lastModified = new Date(stat.mtimeMs).toUTCString();

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': BROWSER_CACHE_CONTROL,
    'CDN-Cache-Control': EDGE_CACHE_CONTROL,
    'ETag': etag,
    'Last-Modified': lastModified,
  };

  // Honour both validators, so the daily browser revalidation costs a 304 and
  // no bytes. If-None-Match wins when both are present, per RFC 9110.
  const ifNoneMatch = request.headers.get('if-none-match');
  const ifModifiedSince = request.headers.get('if-modified-since');
  const matchesETag = ifNoneMatch
    ? ifNoneMatch.split(',').some((candidate) => candidate.trim() === etag)
    : false;
  const notModifiedSince = !ifNoneMatch && ifModifiedSince
    ? Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(ifModifiedSince) / 1000)
    : false;

  if (matchesETag || notModifiedSince) {
    return new Response(null, { status: 304, headers });
  }

  // Stream rather than buffering the whole file into memory per request.
  const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;

  return new Response(body, {
    headers: { ...headers, 'Content-Length': String(stat.size) },
  });
};
