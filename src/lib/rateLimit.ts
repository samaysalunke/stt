const store = new Map<string, { count: number; reset: number }>();

// Prune expired entries every 10 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.reset) store.delete(key);
  }
}, 10 * 60 * 1000).unref();

export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  // Test harness sets this so the suite isn't throttled (never set in prod).
  if (process.env.DISABLE_RATE_LIMIT === 'true') return true;

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count++;
  return true;
}
