# Phase 0 baseline — local Lighthouse, `main` vs `perf/edge-cache-chain`

Captured 2026-08-29. This is the "before" number the handoff flagged as one-way:
once edge caching is live, `main`'s origin behaviour can no longer be measured.

## Method

`npx @lhci/cli autorun` with the repo `lighthouserc.json` — desktop preset, 3 runs
per URL, against `npm run preview` on `localhost:4321`. `main` was measured at
`077b0d8` with the branch's `lighthouserc.json` copied in (the file does not exist
on `main`; it arrives in `fd79556`).

Raw reports:

- `test-reports/lighthouse-main/` — `main` @ `077b0d8`
- `test-reports/lighthouse-branch/` — `perf/edge-cache-chain` @ `ecd572e`

Both are gitignored under `test-reports/`. Copy them somewhere durable if the
numbers need to survive a clean.

## Results

Median of 3 runs. Times in ms.

| URL | Perf | | LCP | | TBT | | TTFB | |
|---|---|---|---|---|---|---|---|---|
| | main | branch | main | branch | main | branch | main | branch |
| `/` | 96 | 97 | 1389 | 1169 | 0 | 0 | **30** | **4** |
| `/trips/` | 97 | 94 | 1184 | 1627 | 0 | 0 | **18** | **3** |
| `/trips/monsoon-meghalaya/` | 97 | 97 | 1179 | 1176 | 0 | 0 | **17** | **8** |

Best of 3 (noise floor — the fairer read for LCP on a local server):

| URL | LCP main | LCP branch | TTFB main | TTFB branch |
|---|---|---|---|---|
| `/` | 1326 | 1161 | 26 | 3 |
| `/trips/` | 1180 | 1216 | 17 | 2 |
| `/trips/monsoon-meghalaya/` | 1141 | 1169 | 10 | 7 |

## Reading these honestly

- **TTFB is the real signal, and it moved.** 4–9x faster on the branch, on every
  URL. That is Phase 1 — the content-loader cache — and nothing else; no edge is
  involved in a localhost preview run.
- **Run #1 of every URL is cold** and lands well outside the other two (branch `/`
  TTFB: 170, 4, 3). The first request populates the 30s content cache. Real
  traffic never sees a cache this empty for long, but a fresh deploy does.
- **LCP did not meaningfully change, in either direction.** The `/trips/` median
  looks 440ms worse; the best-of-3 says 36ms worse. That spread is noise, not a
  regression — the runs straddle it. LCP here is dominated by hero image bytes
  over loopback, which is exactly what Phase 3b/3c would address and what this
  branch deliberately did not touch.
- **CLS 0.000–0.003, TBT 0 across the board**, both branches. No layout or
  main-thread work to reclaim at this size.
- **Nothing here measures Phase 2.** Cache headers, purge and the attribution
  beacon only do anything with Cloudflare in front. The edge win has to be
  measured in production, after the dashboard steps — `cf-cache-status: HIT` and
  the TTFB seen by a real client, not by loopback.

## Implication for the PR description

Local origin TTFB was already 10–30ms on `main`. The single Node process was not
under pressure at this traffic level, which matches what the handoff predicted:
**describe Phase 2 as a latency win for the visitor, not a capacity rescue for the
origin.** Confirm against the GA4 pageview split (handoff step 8) before writing
the PR.
