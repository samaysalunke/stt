import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { deleteImageByUrl, readSiteSettings, saveImageFile, writeSettings } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, allCacheablePaths, TRIP_LISTING_PATHS } from '../../../../lib/cachePurge';

// Fields the settings form is allowed to update. Anything not listed here is
// preserved from the existing site-settings.yaml (merge, not overwrite).
const TEXT_FIELDS = [
  'email', 'phone', 'whatsappLink', 'instagram', 'address',
  'upiId', 'bankAccountName', 'bankAccountNumber', 'bankBranch', 'bankIfsc',
  'googleAnalyticsId', 'googleSiteVerification', 'bingSiteVerification', 'copyrightText',
  'cancellationPolicy', 'termsAndConditions', 'privacyPolicy',
  'cancellationUpdatedAt', 'termsUpdatedAt', 'privacyUpdatedAt',
  // About page copy (blank = built-in default, like the legal overrides)
  'aboutBylineName', 'aboutCaption', 'aboutQuote',
  'aboutBody', 'aboutPrinciplesHeading', 'aboutSignature', 'aboutSignoff',
  'aboutSignName', 'aboutCtaLabel',
];

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();

  // Merge over existing so fields not present in the form are never wiped.
  const existing = readSiteSettings();
  const updated: Record<string, any> = { ...existing };

  for (const field of TEXT_FIELDS) {
    const v = body.get(field);
    if (v !== null) updated[field] = sanitizeInput(v);
  }

  // List field: one URL per line in a textarea -> array
  const igRaw = body.get('instagramImages');
  if (igRaw !== null) {
    updated.instagramImages = igRaw.toString().split('\n').map(s => s.trim()).filter(Boolean);
  }

  // About-page "How we do it differently" principles: parallel title/desc inputs
  // -> array of { title, desc }. Empty rows are dropped; all-empty stores [] so
  // the About page falls back to its built-in defaults.
  const pTitles = body.getAll('aboutPrincipleTitle[]');
  const pDescs = body.getAll('aboutPrincipleDesc[]');
  if (pTitles.length > 0 || pDescs.length > 0) {
    const principles = pTitles
      .map((t, i) => ({ title: sanitizeInput(t), desc: sanitizeInput(pDescs[i]) }))
      .filter(p => p.title || p.desc);
    updated.aboutPrinciples = principles;
  }

  // About portrait: keep the existing image unless a replacement is uploaded.
  // A unique filename avoids stale browser/CDN caches after replacement.
  const portraitFile = body.get('aboutFounderImage');
  let replacedPortrait: unknown = null;
  if (portraitFile instanceof File && portraitFile.size > 0) {
    updated.aboutFounderImage = await saveImageFile(
      portraitFile,
      'images/about',
      `founder-${Date.now()}`,
    );
    replacedPortrait = existing.aboutFounderImage;
  }

  writeSettings(updated);
  if (replacedPortrait) deleteImageByUrl(replacedPortrait);
  await submitToIndexNow(TRIP_LISTING_PATHS);
  await purgeUrls(allCacheablePaths());
  return redirect('/admin/settings?saved=1');
};
