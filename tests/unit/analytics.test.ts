import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { analyzeCustomQuery } from '../../src/lib/analytics/customQuery';
import { createLLMAdapter, LLMConfigError } from '../../src/lib/analytics/llm';
import { cleanupExpiredAnalyticsSessions } from '../../src/lib/analytics/sessions';
import { chooseGranularity, analyticsTools } from '../../src/lib/analytics/tools';
import { buildBookingGrowthWeek, getBookingGrowthWeek } from '../../src/lib/adminDashboard';
import { getDb } from '../../src/lib/db';

async function collectText(adapter: ReturnType<typeof createLLMAdapter>) {
  let text = '';
  for await (const delta of adapter.streamChat({ system: 'system', messages: [{ role: 'user', content: 'hello' }] })) {
    if (delta.type === 'text') text += delta.text ?? '';
  }
  return text;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANALYTICS_LLM_PROVIDER;
  delete process.env.ANALYTICS_LLM_MODEL;
  delete process.env.ANALYTICS_LLM_API_KEY;
  delete process.env.ANALYTICS_LLM_FAKE_RESPONSE;
});

describe('analytics safety and helpers', () => {
  it('builds dashboard booking growth in India business time', () => {
    const week = buildBookingGrowthWeek(
      [
        { d: '2026-06-20', c: 2 },
        { d: '2026-06-25', c: 5 },
        { d: '2026-06-26', c: 7 },
      ],
      new Date('2026-06-25T20:00:00.000Z'),
    );

    expect(week.map((day) => day.key)).toEqual([
      '2026-06-20',
      '2026-06-21',
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
      '2026-06-26',
    ]);
    expect(week.map((day) => day.count)).toEqual([2, 0, 0, 0, 0, 5, 7]);
    expect(week.at(-1)?.label).toBe('Fri');
  });

  it('counts only confirmed seats in dashboard booking growth', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE registrations (
        status TEXT,
        created_at DATETIME,
        status_changed_at DATETIME
      )
    `);
    const insert = db.prepare('INSERT INTO registrations (status, created_at, status_changed_at) VALUES (?, ?, ?)');
    insert.run('lead', '2026-06-26 09:00:00', null);
    insert.run('pending', '2026-06-26 10:00:00', null);
    insert.run('confirmed', '2026-06-20 10:00:00', '2026-06-26 11:00:00');
    insert.run('confirmed', '2026-06-26 12:00:00', null);

    const week = getBookingGrowthWeek(db, new Date('2026-06-26T12:00:00.000Z'));

    expect(week.at(-1)).toMatchObject({ key: '2026-06-26', count: 2 });
    db.close();
  });

  it('uses expected trend granularity thresholds', () => {
    expect(chooseGranularity('2026-01-01', '2026-03-31')).toBe('daily');
    expect(chooseGranularity('2026-01-01', '2026-07-20')).toBe('weekly');
    expect(chooseGranularity('2025-01-01', '2026-06-01')).toBe('monthly');
  });

  it('rejects unknown custom query columns', () => {
    expect(() => analyzeCustomQuery({
      intent: 'bad field',
      tables: ['registrations'],
      select: [{ table: 'registrations', column: 'not_real' }],
    })).toThrow('Query references unknown field: registrations.not_real');
  });

  it('strips PII-only custom query selections', () => {
    expect(() => analyzeCustomQuery({
      intent: 'email list',
      tables: ['registrations'],
      select: [{ table: 'registrations', column: 'email' }],
    })).toThrow('This query would only return restricted fields');
  });

  it('rejects restricted custom query filters instead of widening the query', () => {
    expect(() => analyzeCustomQuery({
      intent: 'filter by email',
      tables: ['registrations'],
      select: [{ table: 'registrations', column: 'status' }],
      filters: [{ table: 'registrations', column: 'email', operator: '=', value: 'test@example.invalid' }],
    })).toThrow('Query filters restricted fields');
  });

  it('rejects malformed custom query operators at runtime', () => {
    expect(() => analyzeCustomQuery({
      intent: 'bad operator',
      tables: ['registrations'],
      select: [{ table: 'registrations', column: 'status' }],
      filters: [{ table: 'registrations', column: 'status', operator: '= 1 OR 1=1 --' as any, value: 'confirmed' }],
    })).toThrow('Query could not be safely executed');
  });

  it('executes a valid demographic custom query', () => {
    const result = analyzeCustomQuery({
      intent: 'gender ratio',
      tables: ['registrations'],
      select: [
        { table: 'registrations', column: 'gender' },
        { table: 'registrations', column: 'id', aggregation: 'COUNT', alias: 'count' },
      ],
      groupBy: [{ table: 'registrations', column: 'gender' }],
      orderBy: [{ table: 'registrations', column: 'gender', direction: 'ASC' }],
    });
    expect(result.columns).toEqual(['gender', 'count']);
    expect(result.rows.length).toBeGreaterThanOrEqual(0);
  });

  it('named resolvers reject mutation SQL text', () => {
    const source = analyticsTools.map((tool) => String(tool.execute)).join('\n');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i);
  });

  it('revenue by trip excludes rejected registrations', () => {
    const db = getDb();
    const marker = `analytics-test-${Date.now()}`;
    db.prepare(
      `INSERT INTO registrations (trip_name, trip_slug, full_name, email, phone, emergency_name, emergency_phone, amount_paid, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(marker, marker, 'Test User', `${marker}@example.invalid`, '9999999999', 'Emergency', '9999999998', 1000, 'confirmed');
    db.prepare(
      `INSERT INTO registrations (trip_name, trip_slug, full_name, email, phone, emergency_name, emergency_phone, amount_paid, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(marker, marker, 'Test User 2', `${marker}b@example.invalid`, '9999999997', 'Emergency', '9999999996', 9999, 'rejected');
    db.prepare(
      `INSERT INTO registrations (trip_name, trip_slug, full_name, email, phone, emergency_name, emergency_phone, amount_paid, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(marker, marker, 'Test User 3', `${marker}c@example.invalid`, '9999999995', 'Emergency', '9999999994', 8888, 'cancelled');

    const tool = analyticsTools.find((t) => t.name === 'getRevenueByTrip')!;
    const result = tool.execute({});
    const slugIndex = result.columns.indexOf('trip_slug');
    const revenueIndex = result.columns.indexOf('revenue');
    const row = result.rows.find((r) => r[slugIndex] === marker);
    expect(row?.[revenueIndex]).toBe(1000); // rejected + cancelled excluded
  });

  it('cleans sessions older than 24 hours', () => {
    const db = getDb();
    const id = `old-${Date.now()}`;
    db.prepare(
      `INSERT INTO analytics_sessions (id, owner_id, created_at, updated_at)
       VALUES (?, ?, datetime('now', '-25 hours'), datetime('now', '-25 hours'))`,
    ).run(id, 'owner-test');
    const removed = cleanupExpiredAnalyticsSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
    const row = db.prepare('SELECT id FROM analytics_sessions WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });
});

describe('analytics LLM adapters', () => {
  it('throws a config error when provider settings are missing', () => {
    expect(() => createLLMAdapter()).toThrow(LLMConfigError);
  });

  it('streams text from the test adapter', async () => {
    process.env.ANALYTICS_LLM_PROVIDER = 'test';
    process.env.ANALYTICS_LLM_FAKE_RESPONSE = 'Deterministic streamed answer.';

    await expect(collectText(createLLMAdapter())).resolves.toBe('Deterministic streamed answer.');
  });

  it('parses OpenAI chat completion streaming chunks', async () => {
    process.env.ANALYTICS_LLM_PROVIDER = 'openai';
    process.env.ANALYTICS_LLM_MODEL = 'test-model';
    process.env.ANALYTICS_LLM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200 })));

    await expect(collectText(createLLMAdapter())).resolves.toBe('Hello world');
  });

  it('parses Anthropic message streaming chunks', async () => {
    process.env.ANALYTICS_LLM_PROVIDER = 'anthropic';
    process.env.ANALYTICS_LLM_MODEL = 'test-model';
    process.env.ANALYTICS_LLM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'event: content_block_delta\n',
      'data: {"delta":{"text":"Hello "}}\n\n',
      'event: content_block_delta\n',
      'data: {"delta":{"text":"world"}}\n\n',
    ].join(''), { status: 200 })));

    await expect(collectText(createLLMAdapter())).resolves.toBe('Hello world');
  });

  it('throws when the LLM provider returns a non-200 response', async () => {
    process.env.ANALYTICS_LLM_PROVIDER = 'openai';
    process.env.ANALYTICS_LLM_MODEL = 'test-model';
    process.env.ANALYTICS_LLM_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    await expect(collectText(createLLMAdapter())).rejects.toThrow('LLM provider request failed');
  });
});
