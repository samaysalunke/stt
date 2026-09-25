import { describe, expect, it } from 'vitest';
import { safeEmailErrorSummary } from '../../src/lib/emailLogs';

describe('email log sanitization', () => {
  it('redacts provider credentials and collapses whitespace', () => {
    const result = safeEmailErrorSummary(
      new Error('Request failed\nBearer secret.token-value with key re_abc123_SECRET'),
    );

    expect(result).toBe('Request failed Bearer [redacted] with key re_[redacted]');
  });
});
