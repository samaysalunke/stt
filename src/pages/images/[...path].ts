import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';

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

/**
 * Responsive width variants, resized on demand.
 *
 * Every image in the library is stored at exactly one size — the upload
 * pipeline caps the long edge at 1920 (see saveImageFile in _contentBase.ts) —
 * and that single file was then served into every slot no matter how small the
 * slot was. On a trip page that meant a 1920x1080 itinerary photo (377 KiB)
 * painting into a 578x326 box and a 1440x1920 cover (338 KiB) into 721x1008.
 * Measured on a throttled mobile connection those two images were most of a
 * 5.3s LCP, and the itinerary photo alone accounted for 1.66s of it by
 * competing with the cover for the pipe.
 *
 * Resizing here rather than at upload time means no backfill of existing
 * images and no extra storage: Cloudflare keeps each width for a year
 * (CDN-Cache-Control above), so the origin encodes any given width once.
 *
 * The allowlist is load-bearing, not tidiness. An open `?w=` would let anyone
 * mint unbounded distinct cache keys and force an unbounded number of sharp
 * encodes on the origin.
 */
const ALLOWED_WIDTHS = new Set([480, 720, 1080, 1440]);
const RESIZABLE_EXT = new Set(['webp', 'jpg', 'jpeg', 'png']);

/** Weak validator: size + mtime is enough to detect a replaced file. */
function weakETag(stat: fs.Stats, width: number | null): string {
  const base = `${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`;
  // The width has to be part of the validator, or a shared cache could hand a
  // resized variant to a request that asked for the original.
  return width ? `W/"${base}-w${width}"` : `W/"${base}"`;
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

  // `?w=` is honoured only for raster formats sharp can read, and only at the
  // allowlisted widths. Anything else falls through to the original file, so
  // every URL that worked before this route learned to resize still does.
  const requestedWidth = Number(new URL(request.url).searchParams.get('w'));
  const width =
    RESIZABLE_EXT.has(ext) && ALLOWED_WIDTHS.has(requestedWidth) ? requestedWidth : null;

  // Variants are always re-encoded to WebP, so the type is known up front and
  // the 304 below carries the same one the 200 would have.
  const contentType = width ? 'image/webp' : MIME[ext] ?? 'application/octet-stream';
  const etag = weakETag(stat, width);
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

  if (width) {
    try {
      // withoutEnlargement means a source narrower than the requested width is
      // returned at its own size rather than upscaled, so a small original
      // never gets blown up to fill a large srcset candidate.
      const resized = await sharp(filePath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      return new Response(new Uint8Array(resized), {
        headers: { ...headers, 'Content-Length': String(resized.length) },
      });
    } catch {
      // A file sharp cannot decode should still be served, just unresized.
      return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
        headers: {
          ...headers,
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Content-Length': String(stat.size),
        },
      });
    }
  }

  // Stream rather than buffering the whole file into memory per request.
  const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;

  return new Response(body, {
    headers: { ...headers, 'Content-Length': String(stat.size) },
  });
};
