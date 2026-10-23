# Product: platform-ai-usage-display

## What it is

A small personal gadget: a TypeScript/Node backend that aggregates AI usage and
subscription quota (Claude, Codex/OpenAI, Grok, Kimi Code, Gemini) and an
ESP32-2432S028 (2.8" 320x240 LVGL touch screen) firmware that shows it.
Provider keys and sessions stay on the backend host; the board only calls
`GET /api/ai-usage` with a device token.

## Who it is for

The owner only. There are no other users and no revenue.

## What works today

- Backend (`backend/`): provider adapters, local subscription-quota probes
  (signed-in CLIs or host quota snapshots), a 60 s cache, honest
  `unavailable` / `no_data` / `stale` states, device-token auth, public
  `/health` and `/ready`.
- Relay mode (`RELAY_MODE=server`): the host pushes its computed payload to a
  hosted copy that holds no provider credentials; the hosted copy also serves
  OTA firmware images to the board.
- Firmware (`firmware/esp32-lvgl/`): quota dashboard, NVS-stored secrets,
  HTTPS to the relay, pull-based OTA updates. Built and flashed by hand with
  Arduino tooling; CI only checks that `secrets.h` is never committed.
- Tests: Vitest suites under `backend/tests/` (adapters, auth, cache, routes,
  relay, firmware store, route access, Sentry scrub, error handling). They use
  fakes and local servers, never live provider APIs.
- CI (`.github/workflows/backend-ci.yml`): shared `ci-node.yml` v1.1.1 on
  `backend/` (typecheck, tests with a 74% line-coverage gate, build, script
  syntax check), firmware hygiene, shared `security.yml`.

## How it runs and deploys

- Host backend: runs on the owner's machine (Docker Compose or `npm run dev`),
  probing providers locally; `scripts/relay-push.mjs` pushes to the relay.
- Hosted relay: Railway project `ai-usage-display`, service `ai-usage-display`
  (production, us-east4, volume at `/data`),
  `https://ai-usage-display-production.up.railway.app` (`/health` 200).
  The service has **no Git source**: its last deployment (2026-10-11) was a
  CLI upload by the owner, built with Railpack. Pushing to `main` does not
  deploy it, and which commit it runs is not recorded.
- Error reporting: `@sentry/node`, errors only, allowlist scrub in
  `backend/src/sentry.ts` (copy adapted from the shared reference). It is a
  no-op until `SENTRY_DSN` is set on the host; no DSN is set yet.

## Limits

- Single user, single device; numbers depend on what each provider exposes.
- The relay keeps the last snapshot in memory only.
- OTA has no automatic rollback.

## Status

Working personal gadget; the hosted relay is live. Owner actions: set
`SENTRY_DSN` on the Railway service (and host backend, if wanted) and redeploy;
optionally connect the Railway service to this repository so deploys are
traceable to a commit.
