import { describe, test, expect } from 'vitest';
import { isValidEmail, isValidPhone, sanitizeInput, slugify, formatCurrency } from '../../src/lib/utils';

// ── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  test('valid address returns true', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  test('valid address with subdomain returns true', () => {
    expect(isValidEmail('qa@test.example.invalid')).toBe(true);
  });

  test('missing @ returns false', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  test('missing domain TLD returns false', () => {
    expect(isValidEmail('user@domain')).toBe(false);
  });

  test('empty string returns false', () => {
    expect(isValidEmail('')).toBe(false);
  });

  test('spaces in address return false', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });

  test('trailing @ returns false', () => {
    expect(isValidEmail('user@')).toBe(false);
  });
});

// ── isValidPhone ──────────────────────────────────────────────────────────────

describe('isValidPhone', () => {
  test('10-digit Indian number returns true', () => {
    expect(isValidPhone('9876543210')).toBe(true);
  });

  test('+91 prefix with spaces returns true', () => {
    expect(isValidPhone('+91 9876543210')).toBe(true);
  });

  test('phone with hyphens returns true', () => {
    expect(isValidPhone('98765-43210')).toBe(true);
  });

  test('too short (5 digits) returns false', () => {
    expect(isValidPhone('12345')).toBe(false);
  });

  test('letters return false', () => {
    expect(isValidPhone('abcdefghij')).toBe(false);
  });

  test('empty string returns false', () => {
    expect(isValidPhone('')).toBe(false);
  });
});

// ── sanitizeInput ─────────────────────────────────────────────────────────────

describe('sanitizeInput', () => {
  test('trims leading and trailing whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  test('returns empty string for null', () => {
    expect(sanitizeInput(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(sanitizeInput(undefined)).toBe('');
  });

  test('returns empty string for number', () => {
    expect(sanitizeInput(42)).toBe('');
  });

  test('truncates at 5000 chars', () => {
    const long = 'a'.repeat(6000);
    expect(sanitizeInput(long)).toHaveLength(5000);
  });

  test('normal string is returned as-is (after trim)', () => {
    expect(sanitizeInput('Mumbai')).toBe('Mumbai');
  });
});

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Triple Sharing')).toBe('triple-sharing');
  });

  test('strips leading and trailing hyphens', () => {
    expect(slugify('  hello world  ')).toBe('hello-world');
  });

  test('collapses multiple non-alphanumeric chars into single hyphen', () => {
    expect(slugify('hello -- world')).toBe('hello-world');
  });

  test('empty string returns empty string', () => {
    expect(slugify('')).toBe('');
  });
});

// ── formatCurrency ────────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  test('formats INR currency', () => {
    const result = formatCurrency(35000);
    expect(result).toContain('35,000');
  });

  test('zero returns formatted zero', () => {
    expect(formatCurrency(0)).toContain('0');
  });
});
