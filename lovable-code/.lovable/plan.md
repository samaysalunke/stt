## Redesign About + Photo Vault

Match the attached editorial references: serif type, blush/cream surfaces, one navy contrast block, coral accents.

### 1. `/about` rewrite
- Top-bar row with `BackButton` (left) + small "by Zahra" centered label + share icon (right).
- Edge-to-edge tall Zahra portrait; small white card pinned bottom-center: serif "The Tour Industry is Broken."
- Blush band with large italic serif pull-quote about tourist-friendly buffets.
- Two body paragraphs (mountain roads / home-cooked meal / silence at dawn; travel should change you).
- Navy contrast block "How we do it differently" with `01 Real People`, `02 Hidden Spots`, `03 Zero Fluff` (coral numbers, white heading, muted body).
- Blush signature block: small caps "WITH LOVE & GRIT," then large coral italic "Zahra".
- Full-width coral CTA pill → `/trips`.
- Remove current stats band, "Why people come" icon grid, and bottom navy CTA.

### 2. `/photo-vault` (list) rewrite
- Light top row: small coral logo dot + "Seek the Thrill" wordmark, bell + avatar on right (decorative).
- Title: serif "The Vault" + italic muted "Every memory, raw and unedited."
- Vertical stack of large rounded album cards. Each card:
  - Coral "N DAYS" pill top-left
  - Bottom gradient with serif title + uppercase subtitle
  - Calendar-icon date row inside card footer
  - Links to `/photo-vault/$album` via `<Link params={{ album: slug }}>`
- Two testimonial cards with quote glyph, italic body, avatar + name.
- Footer signature: small logo + "CURATED BY ZAHRA © 2026".

### 3. New `/photo-vault/$album` route
- File: `src/routes/photo-vault.$album.tsx` with `createFileRoute("/photo-vault/$album")`.
- Loader: looks up album in a new in-file `albums` map (slug → {title, subtitle, photos[]}); `throw notFound()` on miss.
- Top-bar row: back arrow (left) + centered "by Zahra" label.
- Title block: large serif album name + italic coral subtitle.
- Two-column masonry-style grid (`columns-2 gap-3`) of photos with varied aspect ratios. A couple of tiles show a centered play-icon overlay (purely decorative).
- "END OF VAULT" small uppercase divider with short coral rule.
- Footer: "CURATED BY ZAHRA © 2026".

### Data
- Extract album list into a small `src/lib/albums.ts` (slug, title, subtitle, cover, days, date, photos[]) so both list and detail share it. Seed Ladakh with ~8 photos; other albums get a minimal photo set or link to the same detail layout.

### Tokens & deps
- Reuse existing tokens (`--coral`, `--blush`, `--peach`, `--navy`, `--gray-soft`, `font-display`). No new packages.

### Files
- create `src/lib/albums.ts`
- create `src/routes/photo-vault.$album.tsx`
- edit `src/routes/about.tsx`
- edit `src/routes/photo-vault.tsx`
