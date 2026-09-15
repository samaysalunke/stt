#!/usr/bin/env node
/**
 * Register (or inspect) the Telegram webhook.
 *
 * Run once per environment, after the code carrying /api/telegram/webhook is
 * deployed — registering it against a URL that 404s leaves the ops group with
 * buttons that do nothing.
 *
 *   node scripts/telegram-webhook.mjs info
 *   node scripts/telegram-webhook.mjs set   [https://www.seekthethrill.in]
 *   node scripts/telegram-webhook.mjs delete
 *
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment.
 *
 * The secret must be [A-Za-z0-9_-]{1,256} — Telegram's rule, and narrower than
 * it looks: `openssl rand -base64` emits +, / and =, all of which it rejects
 * with the unhelpful "secret token contains illegal characters". Use
 * `openssl rand -hex 32`.
 */

/** Telegram's own charset for secret_token. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const origin = (process.argv[3] || process.env.SITE_URL || 'https://www.seekthethrill.in').replace(/\/$/, '');
const command = process.argv[2] || 'info';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

async function call(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });
  const payload = await res.json().catch(() => ({}));
  if (!payload.ok) throw new Error(`${method}: ${payload.description || res.status}`);
  return payload.result;
}

try {
  if (command === 'info') {
    const info = await call('getWebhookInfo');
    console.log(JSON.stringify({ ...info, url: info.url || '(none)' }, null, 2));
  } else if (command === 'set') {
    if (!secret) {
      console.error('TELEGRAM_WEBHOOK_SECRET is not set — refusing to register an unauthenticated webhook.');
      process.exit(1);
    }
    if (!SECRET_PATTERN.test(secret)) {
      const illegal = [...new Set(secret.replace(/[A-Za-z0-9_-]/g, ''))].join(' ');
      console.error(
        'TELEGRAM_WEBHOOK_SECRET contains characters Telegram will not accept'
        + (illegal ? `: ${illegal}` : ' (or is longer than 256 characters)') + '\n'
        + 'Allowed: A-Z a-z 0-9 _ -   (so not base64 — openssl rand -base64 emits + / =)\n'
        + 'Generate one with:  openssl rand -hex 32\n'
        + 'Then update TELEGRAM_WEBHOOK_SECRET in the deployment and re-run this command.',
      );
      process.exit(1);
    }
    const url = `${origin}/api/telegram/webhook`;
    await call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['callback_query', 'message'],
      // Anything queued while the webhook was unset predates this deployment.
      drop_pending_updates: true,
    });
    console.log(`Webhook set to ${url}`);
  } else if (command === 'delete') {
    await call('deleteWebhook', { drop_pending_updates: true });
    console.log('Webhook deleted.');
  } else {
    console.error(`Unknown command "${command}". Use info | set | delete.`);
    process.exit(1);
  }
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
