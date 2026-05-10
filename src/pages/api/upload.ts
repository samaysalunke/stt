import type { APIRoute } from 'astro';
import { uploadFile } from '../../lib/upload';
import { rateLimit } from '../../lib/rateLimit';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!rateLimit(`upload:${clientAddress}`, 20, 60 * 60 * 1000)) {
    return new Response(JSON.stringify({ success: false, error: 'Too many uploads. Please try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ success: false, error: 'No file provided.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await uploadFile(file);

    return new Response(JSON.stringify({ success: true, url: result.url, filename: result.filename }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[Upload API Error]', err);
    return new Response(JSON.stringify({ success: false, error: err.message ?? 'Upload failed.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
