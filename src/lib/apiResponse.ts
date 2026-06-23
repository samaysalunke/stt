export const jsonOk = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const jsonFail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  jsonOk({ success: false, error, ...extra }, status);
