// Single gate for the /api/test/* helper routes (PII read + destructive delete).
//
// These must NEVER be reachable in production. They are enabled only in a dev
// build (the test harness runs `astro dev`, so import.meta.env.DEV is true), or
// via an explicit, clearly-named opt-in for a non-dev test runner.
//
// Deliberately decoupled from DISABLE_RATE_LIMIT — that flag only tunes
// throttling and must not double as a feature switch for sensitive endpoints.
export function testEndpointsEnabled(): boolean {
  if (import.meta.env.PROD) return false;
  return import.meta.env.DEV || process.env.ENABLE_TEST_ENDPOINTS === 'true';
}
