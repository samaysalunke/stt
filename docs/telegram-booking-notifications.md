# Telegram booking notifications

The booking lifecycle sends one Telegram notification when a live registration
first enters `lead`, and one when it first enters `confirmed`. Bulk imports,
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

Schedule an authenticated `POST /api/jobs/telegram-notifications` request (for
example, once per minute) with this header:

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
