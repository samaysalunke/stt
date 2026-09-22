# Instagram DM → booking attribution

How a trip booking gets traced back to the reel and the DM conversation that
produced it, what each layer actually covers, and what to put in the links the
DM automation sends.

## Why GA4 alone undercounts this badly

UTMs survive the hop out of Instagram — the in-app browser passes query params
through, so GA4 records the session as `instagram / dm`. That is one link in the
chain, and three things break around it:

1. **Resolution.** One link shared by every flow collapses every trip into one
   bucket. Per-flow links are the only way to know which reel filled a batch.
2. **The in-app browser.** Instagram's webview has its own cookie and storage
   partition. Someone reads the trip page in the DM, leaves, and pays from
   Chrome two days later: GA4 sees a fresh direct session. On a ₹20-30k trip
   with a multi-day consideration window that is most of the bookings, so GA4
   reports Instagram as traffic with almost no revenue. It is wrong.
3. **No join to the lead.** GA4's UTMs are aggregate. They cannot say which lead
   came from which reel.

So the attribution of record is ours, not GA4's: the touch is captured on
landing and written onto the lead row at Step 2, where it joins straight to the
booking.

## What is captured, and where it lives

| Layer | Written by | Covers | Loses |
| --- | --- | --- | --- |
| `stt_first_touch` / `stt_latest_touch` cookies, 90 days, httpOnly | `POST /api/attribution` | Everything in the same browser for 90 days | Cleared cookies, another browser |
| localStorage mirror (`stt_first_touch`) | the capture script in `BaseLayout.astro`, on the visit that writes the cookie | The cookie expiring or being cleared — the next visit replays it and the cookie is refilled, for up to the same 90 days | Another browser |
| `first_touch_json` / `latest_touch_json` on the row | `/api/register`, `/api/leads`, `/api/wishlist`, `/api/newsletter` | Permanently, once the form is submitted — this is the copy that joins to revenue | Nothing; it is a snapshot at submit time |
| `subscriber_id` on the link | the DM flow | The hop to a different browser, because it identifies the conversation rather than the device | Flows that do not append it |

Cookie and localStorage are both per-browser: neither recovers someone who reads
in Instagram and pays in Chrome. **The subscriber id is the only thing that
crosses that gap** — it arrives on the landing URL, is stored with the touch, and
lets a booking be matched back to the exact DM thread inside the automation tool.

First touch is written once and never overwritten (`/api/register` COALESCEs it),
so a later campaign cannot take credit for the reel that originally found
someone.

## Link conventions

One link per flow, not one link per account. Zorcha triggers are per-post and
per-keyword, so the flow always knows which reel it is answering:

```
https://www.seekthethrill.in/trips/<trip-slug>/
  ?utm_source=instagram
  &utm_medium=dm
  &utm_campaign=<trip-slug-or-batch>      e.g. goa-sept
  &utm_content=<reel-slug>                e.g. reel-sunset-ferry
  &subscriber_id=<subscriber variable>    e.g. {{subscriber_id}}
```

- `utm_campaign` answers **which batch** the flow is filling. Keep it stable for
  the life of the batch — it is what the admin filters and the CSV group by.
- `utm_content` answers **which reel**. Change it per post, never per send.
- `subscriber_id` answers **which conversation**. `sub_id` is accepted as an
  alias; if both are present `subscriber_id` wins. Whatever merge field the tool
  exposes for the subscriber goes here — it is stored as an opaque reference and
  nothing is derived from it.

`utm_medium=dm` is worth keeping distinct from story and bio-link traffic;
otherwise Instagram is one undifferentiated channel in every report.

## Two things to verify in Zorcha before relying on this

1. **Does it wrap outbound links in its own redirect for click tracking?** If it
   does, confirm the query string survives the redirect. Send yourself a DM,
   tap the link, and check the URL that lands — if the params are gone, the
   trip page sees a bare URL and the whole chain starts at "direct". Either turn
   the wrapping off for these links, or find the setting that forwards params.
2. **Does it expose subscriber variables inside URLs?** If yes, append it as
   above and the loop closes. If not, the UTMs still work and the subscriber
   column simply stays blank.

Both are one manual DM to check, and both are cheap to get wrong silently.

## Reading it back

- **Per trip:** `/admin/registrations/<trip-slug>` — the attribution panel filters
  by channel, utm_source, utm_medium, campaign, utm_content, DM subscriber,
  landing page and referrer, and the stat cards recompute over whatever the
  filter leaves. "Which reel filled this batch" is campaign + utm_content.
- **Which touch those filters read** is the panel's first control:
  - *First touch* (the default) — "what found this traveller". Every existing
    link and bookmark means this, and it is the honest answer to "which reel
    filled this batch", because a later campaign cannot take credit for a visit
    it did not cause.
  - *Latest touch* — "what were they last acting on". This is where the campaign
    lives for someone who found the site another way and came back through a DM.
  - *Either* — "did this campaign touch them at all", the widest count. Note the
    one asymmetry: a value matches when either touch carries it, but the
    "(no campaign)" bucket means *neither* does.

  The choice rides along to the CSV as `touch=latest` / `touch=either`, so a
  download always holds the rows that were on screen. Omitted for first touch,
  so old export URLs are unchanged.
- **Per booking:** the attribution block on an expanded row shows first and
  latest touch, including the DM subscriber when the link carried one.
- **Export:** the same filters apply to `GET /api/admin/export`, which carries
  flat `utm_*`, `subscriber_id`, `landing_page` and `referrer` columns for the
  first touch, then the same set again prefixed `latest_`, alongside the raw
  JSON.

## Known limits

- **The chip on a collapsed row still reads the first touch**, so a traveller
  who arrived another way and came back through a DM reads by their original
  channel there, whatever the Touch control is set to. Their campaign is on the
  expanded row, under Latest touch.
- **"Channel (derived, first touch)" never moves with the Touch control.** It is
  a flat column written once at registration from the first touch; the latest
  touch has no stored equivalent, and deriving one would need a referrer-hostname
  parser the export's SQL cannot have — a filter the screen and the CSV disagree
  about would be worse than one that stays put. Filter on UTM source instead when
  you want the latest touch's channel.
- A first visit with JavaScript disabled records no touch at all. The capture
  moved off the HTML response so it could survive edge caching; see the comment
  at the top of `src/pages/api/attribution.ts`.
- A cookie cleared **mid-session** is refilled on the next visit, not the current
  one — the page cannot read an httpOnly cookie, so it cannot tell that it went
  missing.
- A replayed mirror is only trusted when it carries a campaign or a referrer and
  a real timestamp inside the 90-day window. Anything else — junk, a future
  date, a touch older than the window — is discarded and the current visit
  stands. First touch therefore expires on schedule rather than living forever
  in localStorage.
- The mirror is written from the server's echo, and the echo is only sent on the
  visit that writes the cookie. A visitor who clears localStorage but keeps the
  cookie does not get a new mirror; the alternative was handing a stored first
  touch to any script on the page for the price of an empty POST.
