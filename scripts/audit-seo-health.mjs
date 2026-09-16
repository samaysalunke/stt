#!/usr/bin/env node
/**
 * Is what search engines actually fetch still correct?
 *
 * Written after a Search Console coverage export (2026-09-16) showed 24 of 39
 * known pages unindexed and it took a day of manual curl-ing to establish that
 * every one of them was residue from the pre-2026-08-28 canonicalization bugs
 * (`move-to-prod.md`) and not a live defect. Nothing in the repo could answer
 * "is the served site healthy right now" — the unit tests assert what the code
 * renders, not what Cloudflare and Railway hand to Googlebot after the proxy
 * hop, which is exactly where both of those bugs lived.
 *
 * This checks the seven things that were wrong, or could silently go wrong
 * again, against the running site. It is the automated half of SEO-OPERATIONS.md
 * §3; the rich-result and CWV items there still need a human.
 *
 *   node scripts/audit-seo-health.mjs
 *   node scripts/audit-seo-health.mjs --verbose          # every URL, not just failures
 *   node scripts/audit-seo-health.mjs --origin https://staging.example.com
 *
 * READ-ONLY: unauthenticated GET/HEAD against public URLs, nothing else. It
 * never touches the database, the content volume, or any admin route, so it is
 * safe to point at production. Exits non-zero if any check fails, so CI can
 * gate on it.
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ORIGIN = (value('origin', process.env.SITE_URL ?? 'https://www.seekthethrill.in')).replace(/\/+$/, '');
const VERBOSE = flag('verbose');
const TIMEOUT_MS = Number(value('timeout', '20000'));
const CONCURRENCY = Number(value('concurrency', '6'));

const { host: CANON_HOST, protocol: CANON_PROTO } = new URL(ORIGIN);
/** The bare-domain form of the canonical host, e.g. "seekthethrill.in" for a www origin. */
const APEX_HOST = CANON_HOST.replace(/^www\./, '');
/** Only meaningful when the canonical host is the www one — otherwise there is no apex to leak. */
const APEX_ORIGIN = APEX_HOST === CANON_HOST ? null : `${CANON_PROTO}//${APEX_HOST}`;

const show = (title, rows) => {
  console.log(`\n=== ${title} ===`);
  if (!rows.length) console.log('(no rows)');
  else console.table(rows);
};

/** Run `fn` over `items` with a fixed concurrency ceiling, preserving input order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function request(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'SeekTheThrill-SEO-Audit/1.0 (+https://www.seekthethrill.in)' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Follow redirects by hand so the HOP COUNT is observable. `redirect: 'follow'`
 * hides it, and the hop count is the finding: SEO-OPERATIONS.md §3 requires that
 * http, apex, no-slash and mixed-case each resolve in ONE hop, and the only way
 * a second hop appears is the proxy in front of the app adding its own.
 */
async function probe(url, { method = 'HEAD', maxHops = 5 } = {}) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    let res;
    try {
      res = await request(current, method);
    } catch (error) {
      return { url, status: 0, hops: chain.length, final: current, chain, error: error.name === 'AbortError' ? 'timeout' : error.message };
    }
    // Some edges reject HEAD on dynamic routes; fall back once rather than
    // reporting a 405 the browser would never see.
    if ((res.status === 405 || res.status === 501) && method === 'HEAD') {
      return probe(url, { method: 'GET', maxHops });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).href;
      chain.push(`${res.status} → ${next}`);
      current = next;
      continue;
    }
    return { url, status: res.status, hops: chain.length, final: current, chain, error: null };
  }
  return { url, status: 0, hops: chain.length, final: current, chain, error: 'redirect loop' };
}

async function getText(url) {
  try {
    const res = await request(url, 'GET');
    if (res.status >= 300 && res.status < 400) return { status: res.status, body: '' };
    return { status: res.status, body: await res.text() };
  } catch (error) {
    return { status: 0, body: '', error: error.name === 'AbortError' ? 'timeout' : error.message };
  }
}

const problems = [];
const note = (check, detail) => problems.push({ check, ...detail });

// ── A. Sitemap ─────────────────────────────────────────────────────────────
const sitemapUrl = `${ORIGIN}/sitemap.xml`;
const sitemap = await getText(sitemapUrl);
if (sitemap.status !== 200) {
  console.error(`FATAL: ${sitemapUrl} returned ${sitemap.status || sitemap.error}. Nothing else can be checked.`);
  process.exit(1);
}

const entries = [...sitemap.body.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  loc: (m[1].match(/<loc>(.*?)<\/loc>/) ?? [])[1] ?? '',
  lastmod: (m[1].match(/<lastmod>(.*?)<\/lastmod>/) ?? [])[1] ?? null,
}));
const pageUrls = entries.map((e) => e.loc).filter(Boolean);

console.log(`Auditing ${ORIGIN} — ${pageUrls.length} sitemap URLs`);

// Every sitemap URL must be a 200 with no redirect. A redirecting or missing
// URL in a sitemap is the single clearest "do not trust this site" signal there
// is, and it is what Search Console reports as "Page with redirect".
const missingLastmod = entries.filter((e) => e.loc && !e.lastmod).map((e) => ({ url: e.loc }));
if (missingLastmod.length) {
  show('sitemap entries missing <lastmod>', missingLastmod);
  note('sitemap lastmod', { detail: `${missingLastmod.length} entries without lastmod` });
}

const sitemapProbes = await mapLimit(pageUrls, CONCURRENCY, (u) => probe(u));
const badSitemap = sitemapProbes
  .filter((r) => r.status !== 200 || r.hops !== 0)
  .map((r) => ({ url: r.url, status: r.status || r.error, hops: r.hops, first_hop: r.chain[0] ?? '' }));
show('A. sitemap URLs that are not a direct 200', badSitemap);
if (badSitemap.length) note('sitemap status', { detail: `${badSitemap.length} of ${pageUrls.length} URLs redirect or error` });

// ── B. Page bodies: canonical host, self-canonical, link harvest ───────────
const pages = await mapLimit(pageUrls, CONCURRENCY, async (u) => ({ url: u, ...(await getText(u)) }));

const apexLeaks = [];
const canonicalMismatch = [];
const linkSet = new Set();

for (const page of pages) {
  if (page.status !== 200 || !page.body) continue;

  // The apex 301-strips in Cloudflare, so any absolute apex URL emitted in a
  // canonical, og:url or JSON-LD @id hands search engines a URL that resolves
  // somewhere else. This is bug 3 from move-to-prod.md; it must stay at zero.
  if (APEX_ORIGIN) {
    const hits = page.body.split(`${APEX_ORIGIN}/`).length - 1;
    if (hits > 0) apexLeaks.push({ url: page.url, apex_references: hits });
  }

  const canonical = (page.body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/) ?? [])[1];
  if (!canonical) canonicalMismatch.push({ url: page.url, canonical: '(missing)' });
  else if (canonical !== page.url) canonicalMismatch.push({ url: page.url, canonical });

  for (const m of page.body.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const raw = m[1];
    if (raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('data:')) continue;
    let abs;
    try { abs = new URL(raw, page.url); } catch { continue; }
    if (abs.host !== CANON_HOST) continue;
    // Cloudflare injects /cdn-cgi/ assets (email obfuscation, RUM) into the
    // response after the origin has rendered it. They are not in the repo and
    // not ours to fix, and the email-decode script 404s by design once the
    // feature is off — checking them only produces noise.
    if (abs.pathname.startsWith('/cdn-cgi/')) continue;
    linkSet.add(`${abs.origin}${abs.pathname}${abs.search}`);
  }
}

show('B1. pages emitting apex URLs (should be none)', apexLeaks);
if (apexLeaks.length) note('apex leakage', { detail: `${apexLeaks.length} pages reference ${APEX_ORIGIN}` });

show('B2. pages whose rel=canonical is missing or points elsewhere', canonicalMismatch);
if (canonicalMismatch.length) note('self-canonical', { detail: `${canonicalMismatch.length} pages` });

// ── C. Internal links and assets ───────────────────────────────────────────
// A link to a redirecting URL is not fatal, but it wastes crawl budget and is
// how a rename quietly becomes a 404 later. Both are worth naming.
const links = [...linkSet].sort();
const linkProbes = await mapLimit(links, CONCURRENCY, (u) => probe(u));
const badLinks = linkProbes
  .filter((r) => r.status !== 200 || r.hops !== 0)
  .map((r) => ({ url: r.url.replace(ORIGIN, ''), status: r.status || r.error, hops: r.hops, resolves_to: r.hops ? r.final.replace(ORIGIN, '') : '' }));
show(`C. internal links/assets that are not a direct 200 (${links.length} checked)`, badLinks);
if (badLinks.length) {
  const broken = badLinks.filter((r) => r.status === 404 || r.status === 0).length;
  note('internal links', { detail: `${badLinks.length} not direct 200 (${broken} broken, ${badLinks.length - broken} redirecting)` });
}

// ── D. Canonicalization, one hop each ──────────────────────────────────────
// SEO-OPERATIONS.md §3 in executable form. The app folds host, protocol, case
// and trailing slash into a single 308; a second hop means the edge added one.
const sample = new URL(pageUrls.find((u) => u !== `${ORIGIN}/`) ?? pageUrls[0]);
const noSlash = sample.pathname.replace(/\/$/, '');
const variants = [
  { label: 'http + apex', url: `http://${APEX_HOST}${sample.pathname}` },
  { label: 'https + apex', url: `https://${APEX_HOST}${sample.pathname}` },
  { label: 'http + canonical host', url: `http://${CANON_HOST}${sample.pathname}` },
  { label: 'no trailing slash', url: `${ORIGIN}${noSlash}` },
  { label: 'mixed case', url: `${ORIGIN}${sample.pathname.toUpperCase()}` },
  { label: 'http + no slash (worst case)', url: `http://${CANON_HOST}${noSlash}` },
].filter((v) => APEX_ORIGIN || !v.label.includes('apex'));

const variantProbes = await mapLimit(variants, CONCURRENCY, async (v) => {
  const r = await probe(v.url, { method: 'GET' });
  return { variant: v.label, from: v.url, hops: r.hops, status: r.status || r.error, lands_on: r.final };
});
const wrongLanding = variantProbes.filter((r) => r.status !== 200 || r.lands_on !== `${ORIGIN}${sample.pathname}`);
const multiHop = variantProbes.filter((r) => r.hops > 1);

show('D. canonicalization variants', VERBOSE ? variantProbes : (wrongLanding.length || multiHop.length ? [...new Set([...wrongLanding, ...multiHop])] : []));
if (wrongLanding.length) note('canonicalization', { detail: `${wrongLanding.length} variants do not land on the canonical URL` });
// Reported, not failed: the http hop is Cloudflare's TLS upgrade and is not
// fixable in the app. Flagging it keeps it visible without blocking CI.
if (multiHop.length) console.log(`note: ${multiHop.length} variant(s) take more than one hop — expected for plain-http entry, where the edge upgrades TLS before the app canonicalizes.`);

// ── E. Soft 404s ───────────────────────────────────────────────────────────
// A "not found" page served as 200 gets indexed as a real page. Two shapes:
// a bare unknown path, and an unknown trip slug, which take different branches.
const notFoundProbes = await mapLimit(
  [`${ORIGIN}/audit-probe-nonexistent-${Date.now()}/`, `${ORIGIN}/trips/audit-probe-nonexistent-${Date.now()}/`],
  CONCURRENCY,
  async (u) => {
    const r = await getText(u);
    const robots = (r.body.match(/<meta\s+name="robots"\s+content="([^"]+)"/) ?? [])[1] ?? '';
    return { url: u.replace(ORIGIN, ''), status: r.status, robots: robots || '(none)' };
  },
);
const softNotFound = notFoundProbes.filter((r) => r.status !== 404);
show('E. unknown URLs not returning 404', softNotFound);
if (softNotFound.length) note('soft 404', { detail: `${softNotFound.length} unknown URLs return a non-404 status` });

// ── F. robots.txt ──────────────────────────────────────────────────────────
const robots = await getText(`${ORIGIN}/robots.txt`);
const robotsRows = [];
if (robots.status !== 200) {
  robotsRows.push({ issue: 'robots.txt unreachable', detail: String(robots.status || robots.error) });
} else {
  const declared = [...robots.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  if (!declared.length) robotsRows.push({ issue: 'no Sitemap: directive', detail: '' });
  for (const d of declared) {
    if (d !== sitemapUrl) robotsRows.push({ issue: 'Sitemap: is not the canonical sitemap URL', detail: d });
  }
  // A Disallow on a noindex route stops the crawler reading the noindex, which
  // is the classic way a private page stays in the index forever.
  if (/^\s*Disallow:\s*\/(leaderboard|photo-vault|u)\b/im.test(robots.body)) {
    robotsRows.push({ issue: 'Disallow on a noindex route — blocks the tag it relies on', detail: 'see /leaderboard, /photo-vault, /u' });
  }
}
show('F. robots.txt', robotsRows);
if (robotsRows.length) note('robots.txt', { detail: `${robotsRows.length} issue(s)` });

// ── Summary ────────────────────────────────────────────────────────────────
if (VERBOSE) {
  show('all sitemap URLs', sitemapProbes.map((r) => ({ url: r.url.replace(ORIGIN, '') || '/', status: r.status, hops: r.hops })));
  show('all internal links/assets', linkProbes.map((r) => ({ url: r.url.replace(ORIGIN, ''), status: r.status, hops: r.hops })));
}

show('summary', [
  { check: 'sitemap URLs direct 200', result: `${pageUrls.length - badSitemap.length}/${pageUrls.length}` },
  { check: 'internal links direct 200', result: `${links.length - badLinks.length}/${links.length}` },
  { check: 'pages free of apex URLs', result: APEX_ORIGIN ? `${pages.length - apexLeaks.length}/${pages.length}` : 'n/a (no apex)' },
  { check: 'pages self-canonical', result: `${pages.length - canonicalMismatch.length}/${pages.length}` },
  { check: 'canonicalization variants land correctly', result: `${variantProbes.length - wrongLanding.length}/${variantProbes.length}` },
  { check: 'unknown URLs return 404', result: `${notFoundProbes.length - softNotFound.length}/${notFoundProbes.length}` },
  { check: 'robots.txt', result: robotsRows.length ? `${robotsRows.length} issue(s)` : 'ok' },
]);

if (!problems.length) {
  console.log('\nHEALTHY: every served-site SEO check passed.');
  process.exit(0);
}
console.log(`\nATTENTION: ${problems.length} check(s) failed.`);
console.table(problems);
process.exit(1);
