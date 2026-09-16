# Telegram booking notifications

The booking lifecycle sends one Telegram notification when a live registration
first enters `lead`, one when payment submission moves it to `pending`, and one
when it first enters `confirmed`. Bulk imports,
historical backfills, and registrations that existed before this feature do not
create events. Delivery failures never change a booking API response.

## Setup

1. Message `@BotFather` in Telegram, run `/newbot`, and copy the token into the
   server-only `TELEGRAM_BOT_TOKEN` environment variable.
2. Start a private chat with the bot, or add it to the private destination group
   and send a message there.
3. Before enabling the application, call
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the destination's
   numeric `message.chat.id` into `TELEGRAM_ADMIN_CHAT_ID`. Group IDs are often
   negative. Do not commit the token or put it in client-side code.
4. Redeploy, sign in as an owner or ops admin, and send `POST
   /api/admin/test-telegram`. The response reports only whether configuration is
   present and the Telegram message ID.

## Retry worker

Set `JOBS_SCHEDULER=on` and the server runs this worker in-process every
minute, claiming at most ten events a pass. Without it nothing retries a failed
notification.

`POST /api/jobs/telegram-notifications` remains available for triggering a pass
by hand, with this header:

```text
Authorization: Bearer <TELEGRAM_BOT_TOKEN>
```

Each run atomically claims at most ten events. Definite Telegram `429` and `5xx`
responses retry with bounded backoff, up to three total attempts. Network errors
and timeouts are marked `uncertain` and are not retried because Telegram may have
accepted the request before the connection failed.

Confirmation attachments are resolved only from the validated
`DATA_DIR/uploads` file referenced by that registration. JPG/PNG files use
`sendPhoto`, PDFs use `sendDocument`, and an unavailable attachment produces a
plain `IMAGE UNAVAILABLE` confirmation instead. The existing 5 MB application
upload limit is within the multipart limits documented by the
[Telegram Bot API](https://core.telegram.org/bots/api).

## Two-way actions

Optional. With `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_USERNAME` set and the
webhook registered, each notification carries inline buttons that move the
booking — confirm with the advance or the full payment, cancel with or without a
refund, record an outstanding balance. Without those variables the bot stays
one-way and no buttons are attached, so the group never sees a dead control.

Setup, in this order:

1. Set `TELEGRAM_WEBHOOK_SECRET`, generated with `openssl rand -hex 32`.
   Deliberately **not** the bot token — that already authenticates the retry
   worker, and one compromise should not be two. Telegram sends it back as
   `X-Telegram-Bot-Api-Secret-Token` and it is compared in constant time.

   Use **hex, not base64**. Telegram allows only `A-Z a-z 0-9 _ -` in a secret
   token, so `openssl rand -base64 32` produces `+`, `/` and `=` and `setWebhook`
   fails with the unhelpful `Bad Request: secret token contains illegal
   characters`. `scripts/telegram-webhook.mjs` now refuses such a secret up front
   and names the offending characters.
2. Set `TELEGRAM_BOT_USERNAME` to the bot's `@username`, without the `@`.
3. Deploy.
4. `node scripts/telegram-webhook.mjs set` — after the deploy, never before.
   Registering the webhook against a URL that 404s leaves the ops group with
   buttons that do nothing. `node scripts/telegram-webhook.mjs info` prints the
   current registration; `… delete` removes it and returns the bot to one-way.
5. Each admin opens Admin → Settings → Telegram and presses **Connect Telegram**,
   then **Start** in the chat that opens. The link is single-use and expires in
   ten minutes.

Leave BotFather privacy mode **on**. Callback queries reach the bot regardless,
so it never needs to read group chat messages.

### Who can act

A tap is authorized only if all three hold: the webhook secret matches, the tap
came from `TELEGRAM_ADMIN_CHAT_ID`, and the tapper's Telegram account is linked
to an admin holding `owner` or `ops`. The role is read from `user_roles` on every
tap, so removing someone in Admin → Settings → Roles stops their buttons
immediately — there is no separate Telegram revocation to remember. An admin can
also disconnect their own account from the settings page.

Everything a button does goes through the same functions the admin UI uses
(`applyStatusChange`, `applyPaymentChange`), so the transition matrix, the
capacity check, the payment ledger and the audit log all behave identically —
and every action is attributed to the real admin, not to "the bot".

### What buttons cannot do

Partial refunds, custom advance amounts, and editing traveller details. Those
need a value no button can carry, and each message links straight to the booking
in the admin UI instead.
