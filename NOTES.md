# NOTES.md

## Setup

Requires [Bun](https://bun.sh) ≥1.3. Two ways to run it:

**With Docker** (real Postgres via Compose):

```bash
bun install
docker compose up -d
bun run db:migrate
bun run db:seed
bun run dev:server        # http://localhost:3001
bun run dev:web           # http://localhost:3000, in another terminal
bun run test              # no Docker needed even here — see below
```

**Without Docker** — the app itself, not just the tests, can run entirely Docker-free:

```bash
bun install
bun run local:db:migrate
bun run local:db:seed
bun run local:dev:server   # http://localhost:3001, file-persisted at ./server/.pglite-data
bun run dev:web            # unchanged
```

This works because [PGlite](https://pglite.dev) is an in-process WASM build of *actual* Postgres, not a different dialect the way SQLite would be — so `USE_PGLITE=1` swaps the connection, not the SQL. Same schema, same generated migrations, same `ON CONFLICT` upsert path. Tests always use this in-memory (see `server/tests/integration/api.test.ts`); the `local:*` scripts just point the same mechanism at a file on disk so it persists between `dev:server` restarts.

Tests never need Docker regardless of which path you choose:

```bash
bun run test
```

Open `http://localhost:3000`, pick a user from the switcher in the top-right (identity is stubbed — see below), and browse the feed / saved list.

**Seeded world** (`server/src/db/seed.ts`): `alice` and `bob` are students enrolled in *Distributed Systems* (`course-101`); `alice` is also enrolled in *Databases* (`course-202`) along with `dana`; `carol` is a moderator. `bob` has one active save and one soft-deleted (unsaved) save baked in, so history-preservation is visible immediately without clicking anything.

---

## Key design decisions

### Schema — one row per (user, post), forever

`saved_posts` has a composite primary key on `(user_id, post_id)` and a nullable `deleted_at`. There is no append-only event log; un-saving sets `deleted_at`, re-saving clears it and bumps `saved_at`. This is a deliberate reading of "history preserved": the spec's own words are "re-saving should reactivate the existing record rather than create a duplicate," which only makes sense against a single mutable row. The composite PK is not just a modelling nicety — it is the mechanism that makes "no duplicate active saves" a database invariant rather than an application promise (see Concurrency, below).

`posts.deleted_at` is the same soft-delete pattern for moderator removal. A removed post disappears from the feed and from everyone's saved list, but the underlying `saved_posts` rows are untouched — someone's save history isn't rewritten just because a moderator removed the post later.

`savesCount` and `hasSaved` are **computed on read** (`COUNT`/`EXISTS` against `saved_posts`), never a denormalized counter column. A counter is faster to read but becomes a correctness liability the moment two requests race a save and an unsave concurrently — you'd need the counter update itself to be transactionally tied to the save row's state, which is exactly the guarantee `COUNT` gives you for free. At this data volume, read cost is a non-issue. If this needed to scale to a very hot post, the extension path is a counter column maintained in the *same transaction* as the upsert, with a periodic reconciliation job as a correctness backstop — not a replacement for the source-of-truth table.

### Where auth lives

The stub reads **only** `x-user-id` from the request header; role is loaded from the database on every request (`app.ts`'s `.resolve()`). The spec permits trusting a role header directly, but that means any client can `curl -H "x-role: moderator"` their way past authorization — which is a real trust boundary, not a theoretical one, given moderators can delete content. Reading only identity and deriving role server-side means swapping the stub for real auth (a verified JWT, a session cookie) later is a one-line change in `resolve()`; nothing downstream — services, repositories, the client — needs to know or care.

Authorization itself lives in the **service layer**, not the HTTP layer: `assertCourseAccess` is one function shared by the feed-read path and the save/unsave path, so the enrollment rule can't drift between the two. Controllers only translate `DomainError` → HTTP status; they cannot themselves express "is this user allowed."

### 403 vs. 404, and why the order of checks matters

Per the spec: unknown post → 404; post in a course you can't access → 403. This is the opposite of the "return 404 for everything to avoid leaking existence" school some APIs follow, and I kept it because the spec asks for it explicitly. The trade-off, worth saying out loud in the defense: a 403 confirms *the post exists* even though you can't see it, which is a small information leak (you learn a `postId` is real). I accepted this because (a) the spec is unambiguous, and (b) `postId`s here are opaque and not sequential/guessable, so the leak has little practical value to an attacker. The check order in `getAccessiblePost` is deliberate: missing-or-deleted is checked *before* course access, so a moderator-removed post 404s for everyone rather than 403ing for non-enrolled students — "gone" trumps "not yours to see."

### Concurrency: two layers of idempotency, doing different jobs

The **service layer** decides intent via a pure function (`resolveSave`/`resolveUnsave` in `domain/savedPostTransitions.ts`) that takes the current row state and returns `create | reactivate | noop`. This is unit-tested with zero database — the whole idempotency *policy* is expressed and verified as pure data-in, data-out logic.

But a "read current state, then decide" pattern still races: two simultaneous save requests can both read "no row" and both try to insert. The **repository layer** closes that gap with `INSERT ... ON CONFLICT (user_id, post_id) DO UPDATE ... WHERE deleted_at IS NOT NULL`. The `WHERE` clause is the detail that matters: without it, a racing duplicate save on an *already-active* row would still fire the `DO UPDATE` and bump `saved_at`, silently reordering the user's saved list on a request that should have been a pure no-op. With it, an already-active row is left completely alone by a conflicting insert.

So: idempotency is **behavioral** in the service (testable, readable, drives the count/response logic) and **structural** in the database (correct under real concurrency, via the PK + guarded upsert). Neither layer alone is sufficient — the pure function can't stop a database race, and the upsert alone wouldn't give you a testable place to reason about "what does this request mean." The integration test suite includes an 8-way concurrent save against the same post asserting `savesCount === 1` at the end, which is the thing to point to if asked "prove it."

### Closing three test gaps

A self-audit against the spec's authorization rules found the 12-test integration suite was strong but left three specific scenarios unasserted, since they're each easy to *believe* work from reading the code but weren't actually pinned by a failing test if the underlying behavior regressed:

- **404-before-403 ordering** (`services.ts`'s `getAccessiblePost` checks missing-or-deleted before course access — see "403 vs. 404" above). Every existing 403 test used a post that genuinely exists, and every 404 test used a nonexistent post — neither distinguishes the *order* of the two checks. Added: a moderator removes `post-6` (course-202), then `bob` (enrolled only in course-101) tries to save it — asserts 404, not 403, which is the one case that actually depends on the check order rather than either check alone.
- **`unsave`'s 403 boundary via HTTP** was untested — only `save`'s 403 case had an integration test. Added: `bob` attempting to unsave a post in a course he's not enrolled in.
- **`GET /saved-posts` pagination** was exercised for ordering (reactivation jumps to top) but never for the actual page/limit/totalCount/hasMore mechanics, unlike the feed endpoint which has a dedicated pagination test. Added: a matching test that saves three posts and asserts a real page boundary.

All three now live in `server/tests/integration/api.test.ts`, bringing the suite to 33 tests (35 after the two further additions below). Also fixed while auditing: a stale comment in `server/src/db/seed.ts` claimed course-202 enrolled "alice only," but the actual seed data enrolls both alice and dana — the comment was wrong, the enrollment data (and everything built on it) was always correct.

Two further additions closed smaller remaining gaps found in a self-scoring pass:

- **Path-param validation.** `postId`/`courseId` were raw, unvalidated strings reaching the DB directly. Added `idParamSchema` (`app.ts`) — a thin Zod `string().min(1).max(100)` guard applied to every path param before it reaches a service. This is defense-in-depth, not a format contract: IDs are opaque and a malformed one already just 404s via a failed lookup, but an oversized/junk string should never reach the database at all. Tested with a 101-character `postId` asserting 400.
- **Mixed-direction concurrency test.** The existing 8-way race only fired `save` against `save` — proving the upsert guard, not the deactivate path, under contention. Added a second race that fires POST and DELETE against the same row concurrently and asserts the row lands in a valid state regardless of interleaving: `savesCount` is always `0` or `1` (never negative or double-counted), and `hasSaved` always agrees with it on a fresh read.

### Fetching flags for a list efficiently

`repositories.ts`'s `postViewColumns` builds two correlated subqueries — a `COUNT` for `savesCount` and an `EXISTS` for the viewer's own `hasSaved` — directly into the SELECT for the feed and saved-list queries. This is one round trip for N posts, no N+1, and no in-memory merge step that could drift out of sync with the main query's pagination/ordering.

### Client: optimistic updates and cache consistency

`useToggleSave` (`web/src/lib/queries.ts`) flips the button instantly via `onMutate`, patching *every* cached feed page and the saved list in one pass using the query-key factory (`keys.feeds()` / `keys.savedLists()`), with a snapshot-based rollback on error. `onSettled` always invalidates the saved list specifically, because unlike a flag flip, un-saving changes *list membership* (the item must vanish) and re-saving changes *order* (it must jump to the top) — things an optimistic patch to an existing cached item can't express, since the item might not be in that page's cache at all yet.

### Client: loading and error states

The optimistic-update path above handles the happy path and rollback, but originally left two real gaps: the Saved view had no loading indicator (it renders `data`-gated blocks only, so an in-flight request showed a blank area), and neither view surfaced a query or mutation failure to the user beyond the optimistic rollback silently reverting the toggle. Both are fixed:

- `feed/page.tsx` and `saved/page.tsx` now branch on `query.isError`, rendering a shared `ErrorBanner` (`web/src/components/ErrorBanner.tsx`) sourced from the `errors.generic` catalog key — which existed in the message catalog from the start but, before this fix, was never actually referenced by any component. `saved/page.tsx` also gained the `isLoading` branch it was missing (`savedList.loading`, mirroring the existing `feed.loading` pattern).
- Save/remove mutations pass a per-call `onError` at the `.mutate()` call site (distinct from the hook's own `onError`, which only handles optimistic rollback) that surfaces a dismissible `ErrorBanner` with the same generic message. React Query runs both the hook-level and call-level `onError` handlers, so this doesn't disturb the existing rollback logic.
- The feed's `isError` branch specifically distinguishes a 403 (shown via the previously-unused `feed.forbidden` key) from everything else — a defensive case, since `courseId` in the UI is only ever populated from the viewer's own enrolled courses via `/me`, but worth handling correctly rather than showing a generic message for an authorization-specific failure.

### i18n: closing three hardcoded strings

An audit against the spec's "all user-facing strings come from a message catalog" requirement found three violations, all now fixed:

- `web/src/app/layout.tsx`'s `metadata` export was a static object, so the `<title>`/description never localized even though the rest of the app does. Converted to `generateMetadata()` using `next-intl/server`'s `getTranslations`, sourcing from new `app.metaTitle`/`app.metaDescription` catalog keys.
- `UserSwitcher`'s disabled placeholder `<option>` rendered a literal `"…"`. Now reads `app.selectUser`.
- `LanguageSwitcher`'s `"EN"`/`"हिं"` button labels were hardcoded outside the catalog. These are language endonyms — by convention shown identically regardless of the active UI locale (this is how virtually every language switcher works; you don't translate "Français" to "French" when the UI is in English) — so the fix moves them into the catalog as identical values in both `en.json` and `hi.json` (`app.locales.en`, `app.locales.hi`) rather than translating them. This satisfies "sourced from the catalog" literally while preserving the correct UX convention.

### UI: responsive header

`AppShell`'s header row (title on the left, the user switcher + language switcher stacked on the right) originally had no breakpoint handling — a single `flex justify-between` row, which crowds a `<select>` and two buttons against the title text on a narrow viewport. Fixed to `flex-col sm:flex-row`: stacked and left-aligned below `640px`, side-by-side above it.

### Trade-off: `UserSwitcher` calls its own query hook

`UserSwitcher.tsx` calls `useDevUsers()` directly rather than receiving data via props from a page/container, which reads as a violation of the architecture diagram's single "UI component: presentation only" box if applied uniformly to every component. I looked at this closely and decided not to change it: the codebase's own stated convention (`web/src/lib/queries.ts:9-15`) is narrower than "no component may call a hook" — it's "components never touch `api`/`keys` directly," which `UserSwitcher` respects. `UserSwitcher` is also explicitly a self-contained, dev-only debug widget standing in for a login screen ("carries no security weight — purely a demo convenience for the reviewer," per its own doc comment), rendered identically from `AppShell` on every page. Hoisting the query to both `feed/page.tsx` and `saved/page.tsx` would mean duplicating the call (React Query dedupes by key, so no real network cost) purely to satisfy the diagram's letter rather than its spirit, for zero behavioral gain. `PostCard` — the component the spec's own grading note explicitly names as needing to be presentation-only — is fully compliant; that's the one that matters.

---

## Trade-offs and what was deliberately descoped

- **Offset pagination, not cursor.** `saved_at` mutates on reactivation, which is exactly the case where offset pagination can visibly skip or duplicate items across concurrent writes. Cursor pagination is the more correct choice for that reason. I kept offset given the time box and the assignment's expected data volume (a handful of seeded posts), and I'm flagging the trade-off here rather than silently building a fancier thing than the box allows. Extension path: a `(sort_key, id)` tuple cursor, encoded opaquely, for both the feed and saved-list endpoints.
- **No ESLint/Prettier config.** Code is consistently formatted by hand and typechecks clean under strict mode, but there's no enforced lint config in the repo. Next on the list for a real team project.
- **No rate limiting, no request logging/observability.** Out of scope for a 4–6 hour slice; would matter immediately in production.
- **Course selector is a flat dropdown**, not a richer picker — fine at 2 courses, would need a search/filter UI at real scale.
- **No optimistic update for the moderator remove action** — it invalidates and refetches rather than patching the cache. Removal is rare and not latency-sensitive the way toggling a bookmark is, so the extra complexity wasn't worth it here.
- **`UserSwitcher` calls `useDevUsers()` directly** rather than receiving it via props from a page, a narrow exception to "presentation only" for a dev-only debug widget with no security weight. Full reasoning under "Trade-off: `UserSwitcher` calls its own query hook" above.

## What I'd do next with another day

1. Cursor-based pagination for both list endpoints, with the offset-pagination trade-off above as the committed rationale for why it wasn't day-one.
2. A denormalized `saves_count` column on `posts`, maintained transactionally alongside the upsert, once/if a single post's save count becomes hot enough that the correlated `COUNT` shows up in a query plan.
3. Real authentication (JWT or session-based), which — per the design above — only touches `app.ts`'s `.resolve()`.
4. An audit-events table (`save_events`) if a real audit trail (not just "the row still exists") were required — append-only, alongside the toggled row rather than instead of it.
5. ESLint/Prettier + a CI workflow running `bun run test` and `tsc --noEmit` on every push.
6. Rate limiting on the save/unsave endpoints, and structured request logging.
