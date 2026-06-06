import type { APIRoute } from 'astro';
import { readSiteSettings, writeSettings } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

// Fields the settings form is allowed to update. Anything not listed here is
// preserved from the existing site-settings.yaml (merge, not overwrite).
const TEXT_FIELDS = [
  'email', 'phone', 'whatsappLink', 'instagram', 'address',
  'googleAnalyticsId', 'copyrightText',
  'cancellationPolicy', 'termsAndConditions', 'privacyPolicy',
  'defaultPaymentInstructions', 'bankDetails',
];
const NUMBER_FIELDS = [
  'tripsCompleted', 'happyTravelers', 'destinationsCovered', 'yearsOfAdventure',
];

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  // Merge over existing so fields not present in the form are never wiped.
  const updated: Record<string, any> = { ...readSiteSettings() };

  for (const field of TEXT_FIELDS) {
    const v = body.get(field);
    if (v !== null) updated[field] = sanitizeInput(v);
  }
  for (const field of NUMBER_FIELDS) {
    const v = body.get(field);
    if (v !== null && v.toString().trim() !== '') updated[field] = Number(v);
  }

  // List field: one URL per line in a textarea -> array
  const igRaw = body.get('instagramImages');
  if (igRaw !== null) {
    updated.instagramImages = igRaw.toString().split('\n').map(s => s.trim()).filter(Boolean);
  }

  writeSettings(updated);
  return redirect('/admin/settings?saved=1');
};
