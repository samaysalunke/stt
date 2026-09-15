/**
 * The three gates on POST /api/telegram/webhook.
 *
 * Exercised as a unit rather than through the API suite because proving these
 * end-to-end would mean putting a real TELEGRAM_BOT_TOKEN in the shared test
 * server's environment, which would make the existing notification tests
 * actually dial api.telegram.org.
 *
 * The Telegram API and the action router are mocked; the link layer is real, so
 * the authorization decisions here are the ones production makes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;
vi.mock('../../src/lib/db', () => ({ getDb: () => db }));

const answerCallbackQuery = vi.fn();
const sendDirectMessage = vi.fn();
vi.mock('../../src/lib/telegram', () => ({
  answerCallbackQuery: (...args: unknown[]) => answerCallbackQuery(...args),
  sendDirectMessage: (...args: unknown[]) => sendDirectMessage(...args),
  telegramActionsConfigured: () => true,
  telegramAdminChatId: () => '-100999',
  telegramWebhookSecret: () => 'correct-horse-battery-staple',
}));

const handleCallbackQuery = vi.fn();
vi.mock('../../src/lib/telegramActions', () => ({
  handleCallbackQuery: (...args: unknown[]) => handleCallbackQuery(...args),
}));

vi.mock('../../src/lib/audit', () => ({ logAction: vi.fn() }));

const { POST } = await import('../../src/pages/api/telegram/webhook');
const { consumeLinkToken, createLinkToken } = await import('../../src/lib/telegramLink');

const SECRET = 'correct-horse-battery-staple';
const OPS_CHAT = '-100999';

function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret;
  const request = new Request('https://www.seekthethrill.in/api/telegram/webhook', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return (POST as any)({ request });
}

let updateId = 1;
const tap = (fromId: string, chatId = OPS_CHAT) => ({
  update_id: updateId++,
  callback_query: {
    id: `cbq-${updateId}`,
    data: 'b:1:cf:advance_paid',
    from: { id: fromId, first_name: 'Tester' },
    message: { message_id: 500, chat: { id: chatId } },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, displayName TEXT);
    CREATE TABLE user_roles (userId TEXT, role TEXT, PRIMARY KEY (userId, role));
    CREATE TABLE telegram_admin_links (
      telegram_user_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, telegram_username TEXT,
      linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at DATETIME
    );
    CREATE TABLE telegram_link_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at DATETIME NOT NULL,
      consumed_at DATETIME, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE telegram_updates_seen (
      update_id INTEGER PRIMARY KEY, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users VALUES ('u-ops', 'ops@example.invalid', 'Ops Person');
    INSERT INTO users VALUES ('u-lead', 'lead@example.invalid', 'Trip Lead');
    INSERT INTO user_roles VALUES ('u-ops', 'ops');
    INSERT INTO user_roles VALUES ('u-lead', 'trip_lead');
  `);
});

describe('gate 1 — the webhook secret', () => {
  it('rejects a missing, wrong, or truncated secret without acting', async () => {
    for (const secret of [null, '', 'wrong', SECRET.slice(0, -1), `${SECRET}x`]) {
      const res = await post(tap('55501'), secret);
      expect(res.status, String(secret)).toBe(401);
    }
    expect(handleCallbackQuery).not.toHaveBeenCalled();
    expect(answerCallbackQuery).not.toHaveBeenCalled();
  });
});

describe('gate 2 — the chat', () => {
  it('refuses a tap from any chat but the ops group', async () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    const res = await post(tap('55501', '-100111'));
    expect(res.status).toBe(200);
    expect(handleCallbackQuery).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith(expect.any(String), 'Not available here.', true);
  });
});

describe('gate 3 — the tapper', () => {
  it('refuses anyone whose Telegram account is not linked', async () => {
    await post(tap('80808'));
    expect(handleCallbackQuery).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/not connected/i), true);
  });

  it('refuses a linked admin whose role cannot move bookings', async () => {
    consumeLinkToken(createLinkToken('u-lead'), '42424');
    await post(tap('42424'));
    expect(handleCallbackQuery).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/role/i), true);
  });

  it('refuses immediately after the role is revoked, with no second revocation step', async () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    await post(tap('55501'));
    expect(handleCallbackQuery).toHaveBeenCalledTimes(1);

    db.prepare("DELETE FROM user_roles WHERE userId='u-ops'").run();
    await post(tap('55501'));
    expect(handleCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it('lets a linked ops admin through, carrying their identity', async () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    const res = await post(tap('55501'));
    expect(res.status).toBe(200);
    expect(handleCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'b:1:cf:advance_paid' }),
      expect.objectContaining({ userId: 'u-ops', email: 'ops@example.invalid', role: 'ops' }),
    );
  });
});

describe('replay and failure handling', () => {
  it('runs a redelivered update_id exactly once', async () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    const update = tap('55501');
    await post(update);
    await post(update);
    await post(update);
    expect(handleCallbackQuery).toHaveBeenCalledTimes(1);
  });

  /** A non-2xx makes Telegram redeliver, and redelivering a state change is worse than dropping one. */
  it('answers 200 even when the action router throws', async () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    handleCallbackQuery.mockRejectedValueOnce(new Error('kaboom'));
    expect((await post(tap('55501'))).status).toBe(200);
  });

  it('answers 200 to malformed bodies and updates it cannot use', async () => {
    const bad = new Request('https://www.seekthethrill.in/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: 'not json',
    });
    expect((await (POST as any)({ request: bad })).status).toBe(200);
    expect((await post({ update_id: 9001 })).status).toBe(200);
    expect(handleCallbackQuery).not.toHaveBeenCalled();
  });
});

describe('/start linking', () => {
  it('links from a private chat and confirms it', async () => {
    const token = createLinkToken('u-ops');
    await post({ update_id: 7001, message: { chat: { id: 5551, type: 'private' }, from: { id: 5551, username: 'ops' }, text: `/start ${token}` } });
    expect(sendDirectMessage).toHaveBeenCalledWith(5551, expect.stringMatching(/connected/i));
    const link = db.prepare('SELECT user_id FROM telegram_admin_links WHERE telegram_user_id=?').get('5551') as any;
    expect(link?.user_id).toBe('u-ops');
  });

  /** A token pasted into the group would be readable by everyone in it. */
  it('ignores /start in a group chat entirely', async () => {
    const token = createLinkToken('u-ops');
    await post({ update_id: 7002, message: { chat: { id: OPS_CHAT, type: 'supergroup' }, from: { id: 5551 }, text: `/start ${token}` } });
    expect(sendDirectMessage).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) n FROM telegram_admin_links').get()).toEqual({ n: 0 });
    // and the token survives for legitimate private use
    expect(consumeLinkToken(token, '5551').ok).toBe(true);
  });

  it('explains an expired or reused token instead of linking', async () => {
    const token = createLinkToken('u-ops');
    consumeLinkToken(token, '9999');
    await post({ update_id: 7003, message: { chat: { id: 5551, type: 'private' }, from: { id: 5551 }, text: `/start ${token}` } });
    expect(sendDirectMessage).toHaveBeenCalledWith(5551, expect.stringMatching(/already been used/i));
  });
});
