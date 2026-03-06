import type { APIRoute } from 'astro';
import { uploadFile } from '../../lib/upload';

export const POST: APIRoute = async ({ request }) => {
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
