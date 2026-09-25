# AGENTS.md

Guidance for coding agents working in this repo.

## Testing

- **Never write unit tests after you write code.** A test written to fit code
  that already exists only restates the implementation; it passes by
  construction and catches nothing.

- **Highly prefer E2E tests as the sole testing mechanism.** Use them to verify
  that complex features actually work, end to end, the way a user or an
  operator would hit them:
  - `tests/e2e/*.spec.ts` — Playwright, drives the real site in a browser
    (`npm run test:e2e`).
  - `tests/api/*.test.mjs` — hits a real dev server over HTTP with a real
    database (`npm run test:api`).

  At the end of an E2E test, produce a verifiable and repeatable artifact —
  e.g. the merged report from `npm run test:report` (`test-reports/report.md`),
  a Playwright screenshot/trace or visual snapshot, or the rows/response bodies
  the test asserted on written to `test-reports/`. Someone else must be able to
  re-run the same command against the same seed and get the same artifact.

- **If you must test a system in isolation**, first write down all the ways it
  could fail, *then* write the code. Each isolated test should map to one of
  those written-down failure modes, and should only exist if E2E tests can't
  reach that failure (money math edge cases, timezone boundaries, parsers of
  messy real-world data, security sanitisation, one-off import scripts).

Unit tests in `tests/unit/` are held to that bar: if a test wouldn't catch a
real bug the E2E suites miss, delete it rather than add to it.
