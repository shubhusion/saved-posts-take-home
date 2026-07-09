# Community Forum — Saved Posts

A course discussion forum with a bookmarking ("Saved Posts") feature: students can save/un-save posts idempotently, see their saved list, and moderators can remove posts. Built as a Bun + Elysia API and a Next.js client in a single workspace.

**See [`NOTES.md`](./NOTES.md) for setup commands, key design decisions, trade-offs, and the "what's next" list — that's the primary document for this submission.**

## What's here

- **Data model**: Postgres + Drizzle. Bookmarks are one mutable row per `(user, post)` with a composite primary key and a soft-delete column, so un-save/re-save history is preserved without ever creating duplicates. See "Schema" in NOTES.md.
- **API & authorization**: Elysia + Zod. Identity comes from a stubbed `x-user-id` header; role is always re-derived from the database, never trusted from the client. Enforces 401 (unauthenticated) / 403 (not enrolled) / 404 (post missing or removed) / OWN (a saved list is always the caller's own) exactly as specified.
- **Business logic**: idempotency and reactivation are pure functions (`server/src/domain/savedPostTransitions.ts`), unit-tested with zero database, then closed against real concurrency with a guarded `ON CONFLICT` upsert at the repository layer.
- **Client**: React Query v5 with optimistic save/un-save toggles, snapshot-based rollback on error, and a typed API client (Eden Treaty) generated directly from the server's types — no hand-written DTOs to drift out of sync.
- **UI**: a feed view and a separate Saved view (with an empty state), a bookmark toggle, and a moderator-only remove action — all presentation-only components driven by props, with loading and error states surfaced explicitly rather than silently.
- **i18n**: every user-facing string comes from a message catalog (`web/src/messages/{en,hi}.json`), with correct ICU pluralization for the saves count ("1 save" / "12 saves").
- **Tests**: Vitest. Pure unit tests for the idempotency/reactivation logic, service-layer tests against an in-memory fake (no database), and integration tests that drive the real HTTP surface against an in-process Postgres (PGlite) — 35 tests total, covering every authorization boundary, both same- and mixed-direction concurrency races, plus the happy path.

## Quick start

```bash
bun install
docker compose up -d      # Postgres
bun run db:migrate
bun run db:seed
bun run dev:server        # http://localhost:3001
bun run dev:web           # http://localhost:3000, in another terminal
bun run test              # unit + API tests, no Docker required (in-process PGlite)
```

### No Docker available?

The whole app can run without Docker too. PGlite is an in-process WASM build of *actual* Postgres (not a different dialect), so this is genuinely the same database engine, just embedded and file-persisted instead of containerized:

```bash
bun install
bun run local:db:migrate
bun run local:db:seed
bun run local:dev:server   # http://localhost:3001, backed by ./server/.pglite-data
bun run dev:web            # http://localhost:3000, in another terminal — unchanged
```

## Testing

```bash
bun run test                                # unit + integration tests (Docker-free, PGlite)
bun run --cwd server typecheck              # strict TypeScript, server package
bun run --cwd web typecheck                 # strict TypeScript, web package
```

- `server/tests/unit/savedPostTransitions.test.ts` — pure save/un-save/reactivate decision logic, zero I/O.
- `server/tests/unit/services.test.ts` — service layer against an in-memory fake repository, still zero database.
- `server/tests/integration/api.test.ts` — real HTTP requests via `app.handle()` against an in-process Postgres (PGlite), running the same generated migrations as production. Covers 401/403/404/OWN, idempotent save/un-save, reactivation, an 8-way concurrent-save race, feed and saved-list pagination, and moderation.

## API quick reference

All requests need an `x-user-id` header (the auth stub — see NOTES.md for why role is *never* read from a client-supplied header). These use the deterministic seed data, so they're copy-pasteable against a freshly seeded database:

```bash
# Feed for a course alice is enrolled in, newest first
curl -H "x-user-id: alice" "http://localhost:3001/courses/course-101/posts"

# Save a post (idempotent — repeat this and the count won't change)
curl -X POST -H "x-user-id: alice" "http://localhost:3001/posts/post-1/save"

# Alice's saved list, most-recently-saved first
curl -H "x-user-id: alice" "http://localhost:3001/saved-posts"

# Un-save (soft delete — history is preserved, not destroyed)
curl -X DELETE -H "x-user-id: alice" "http://localhost:3001/posts/post-1/save"

# Moderator-only: remove a post (403 for a student, e.g. alice)
curl -X DELETE -H "x-user-id: carol" "http://localhost:3001/posts/post-1"
```

## Layout

```
server/   Bun + Elysia + Drizzle + Zod API (server/src, server/tests)
web/      Next.js (App Router) + React Query + Eden Treaty + next-intl client
```
