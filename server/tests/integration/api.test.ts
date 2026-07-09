import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import * as schema from "../../src/db/schema";
import { seed } from "../../src/db/seed";

/**
 * End-to-end API tests against an in-process Postgres (PGlite):
 *   - runs the SAME generated migrations as production,
 *   - exercises the real ON CONFLICT upsert path,
 *   - drives the real Elysia HTTP surface via app.handle(Request),
 *   - needs no Docker, so `bun run test` passes from a clean checkout.
 */

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const pglite = new PGlite(); // in-memory
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seed(db);
  app = createApp(db);
});

const api = (path: string, init: RequestInit = {}, userId?: string) =>
  app.handle(
    new Request(`http://test${path}`, {
      ...init,
      headers: { ...(userId ? { "x-user-id": userId } : {}), ...init.headers },
    }),
  );

describe("authentication boundary", () => {
  it("401s any forum endpoint without the auth header", async () => {
    for (const path of ["/me", "/courses/course-101/posts", "/saved-posts"]) {
      const res = await api(path);
      expect(res.status, path).toBe(401);
    }
  });

  it("401s an unknown user id", async () => {
    const res = await api("/courses/course-101/posts", {}, "mallory");
    expect(res.status).toBe(401);
  });
});

describe("authorization boundaries", () => {
  it("403s a student reading a feed for a course they are not enrolled in", async () => {
    const res = await api("/courses/course-202/posts", {}, "bob");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("403s a student saving a post in a non-enrolled course", async () => {
    const res = await api("/posts/post-5/save", { method: "POST" }, "bob");
    expect(res.status).toBe(403);
  });

  it("404s a save against a post that does not exist", async () => {
    const res = await api("/posts/post-404/save", { method: "POST" }, "alice");
    expect(res.status).toBe(404);
  });

  it("lets a moderator read any course feed (enrollment bypass)", async () => {
    const res = await api("/courses/course-202/posts", {}, "carol");
    expect(res.status).toBe(200);
  });

  it("OWN rule: a user's saved list only ever contains their own saves", async () => {
    // bob has an active seeded save; alice starts empty. There is no route
    // parameter for "someone else's list" — assert alice cannot see bob's.
    const res = await api("/saved-posts", {}, "alice");
    const body = await res.json();
    expect(body.items).toHaveLength(0);
  });

  it("403s an unsave for a student in a non-enrolled course", async () => {
    // post-5 is in course-202; bob is only enrolled in course-101.
    const res = await api("/posts/post-5/save", { method: "DELETE" }, "bob");
    expect(res.status).toBe(403);
  });

  it("404-before-403: a moderator-removed post 404s even for a non-enrolled student", async () => {
    // post-6 is in course-202, which bob is NOT enrolled in. If course
    // access were checked before existence, this would 403; the spec (and
    // services.ts's getAccessiblePost) requires "gone" to win, so it 404s.
    let res = await api("/posts/post-6", { method: "DELETE" }, "carol");
    expect(res.status).toBe(200);

    res = await api("/posts/post-6/save", { method: "POST" }, "bob");
    expect(res.status).toBe(404);
  });
});

describe("save lifecycle (happy path + idempotency + reactivation)", () => {
  it("save -> appears in saved list -> double-save no-op -> unsave -> re-save reactivates", async () => {
    // 1. Alice saves post-1. bob has not saved it, so count goes 0 -> 1.
    let res = await api("/posts/post-1/save", { method: "POST" }, "alice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSaved: true, savesCount: 1 });

    // 2. It shows up in her saved list, hydrated.
    res = await api("/saved-posts", {}, "alice");
    let list = await res.json();
    expect(list.items.map((i: { id: string }) => i.id)).toContain("post-1");
    const item = list.items.find((i: { id: string }) => i.id === "post-1");
    expect(item.hasSaved).toBe(true);
    expect(item.savesCount).toBe(1);
    const firstSavedAt = item.savedAt;

    // 3. Feed reflects the flags for Alice...
    res = await api("/courses/course-101/posts", {}, "alice");
    const feed = await res.json();
    const feedItem = feed.items.find((i: { id: string }) => i.id === "post-1");
    expect(feedItem).toMatchObject({ hasSaved: true, savesCount: 1 });

    // ...but hasSaved is per-viewer: bob sees the count, not her flag.
    res = await api("/courses/course-101/posts", {}, "bob");
    const bobFeed = await res.json();
    expect(bobFeed.items.find((i: { id: string }) => i.id === "post-1")).toMatchObject({
      hasSaved: false,
      savesCount: 1,
    });

    // 4. Double save: no error, no double count, saved_at NOT bumped.
    res = await api("/posts/post-1/save", { method: "POST" }, "alice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSaved: true, savesCount: 1 });
    res = await api("/saved-posts", {}, "alice");
    list = await res.json();
    expect(list.items.find((i: { id: string }) => i.id === "post-1").savedAt).toBe(firstSavedAt);

    // 5. Unsave: soft delete, count back to 0, gone from the list.
    res = await api("/posts/post-1/save", { method: "DELETE" }, "alice");
    expect(await res.json()).toEqual({ hasSaved: false, savesCount: 0 });
    res = await api("/saved-posts", {}, "alice");
    list = await res.json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain("post-1");

    // 6. Unsave again: idempotent no-op.
    res = await api("/posts/post-1/save", { method: "DELETE" }, "alice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSaved: false, savesCount: 0 });

    // 7. Re-save: the SAME row reactivates with a newer savedAt (top of list).
    await new Promise((r) => setTimeout(r, 10));
    res = await api("/posts/post-1/save", { method: "POST" }, "alice");
    expect(await res.json()).toEqual({ hasSaved: true, savesCount: 1 });
    res = await api("/saved-posts", {}, "alice");
    list = await res.json();
    const reactivated = list.items.find((i: { id: string }) => i.id === "post-1");
    expect(new Date(reactivated.savedAt).getTime()).toBeGreaterThan(new Date(firstSavedAt).getTime());
    expect(list.items[0].id).toBe("post-1"); // most-recently-saved first
  });

  it("survives concurrent duplicate saves with a single active row (upsert)", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api("/posts/post-4/save", { method: "POST" }, "alice")),
    );
    for (const r of results) expect(r.status).toBe(200);
    const res = await api("/courses/course-101/posts", {}, "alice");
    const feed = await res.json();
    expect(feed.items.find((i: { id: string }) => i.id === "post-4").savesCount).toBe(1);
  });

  it("stays consistent under a mixed concurrent save/unsave race on the same row", async () => {
    // Unlike the same-direction race above, this fires POST and DELETE
    // against the same row at once — exercising the guarded upsert and the
    // deactivate path together. Whichever way the race resolves, the row
    // must land in a valid state: never a negative or double count, and
    // hasSaved/savesCount must agree with each other on a fresh read.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api("/posts/post-4/save", { method: i % 2 === 0 ? "POST" : "DELETE" }, "alice"),
      ),
    );
    for (const r of results) expect(r.status).toBe(200);

    const res = await api("/courses/course-101/posts", {}, "alice");
    const feed = await res.json();
    const item = feed.items.find((i: { id: string }) => i.id === "post-4");
    expect([0, 1]).toContain(item.savesCount);
    expect(item.hasSaved).toBe(item.savesCount === 1);
  });
});

describe("feed shape and pagination", () => {
  it("returns newest-first, paginated, with total count", async () => {
    const res = await api("/courses/course-101/posts?page=1&limit=2", {}, "alice");
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.totalCount).toBe(4);
    expect(body.hasMore).toBe(true);
    const dates = body.items.map((i: { createdAt: string }) => new Date(i.createdAt).getTime());
    expect(dates[0]).toBeGreaterThan(dates[1]); // newest first

    const page2 = await (await api("/courses/course-101/posts?page=2&limit=2", {}, "alice")).json();
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    const ids = new Set([...body.items, ...page2.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(4); // no overlap across pages
  });

  it("400s malformed pagination input (Zod)", async () => {
    const res = await api("/courses/course-101/posts?limit=999", {}, "alice");
    expect(res.status).toBe(400);
  });

  it("400s an oversized postId before it ever reaches the database", async () => {
    const res = await api(`/posts/${"x".repeat(101)}/save`, { method: "POST" }, "alice");
    expect(res.status).toBe(400);
  });

  it("paginates the saved-posts list itself, not just the feed", async () => {
    // Reset alice to a clean slate regardless of what earlier tests in this
    // file left behind (unsave is idempotent, so this is safe either way),
    // then save exactly three posts so pagination has a real page boundary.
    await api("/posts/post-1/save", { method: "DELETE" }, "alice");
    await api("/posts/post-4/save", { method: "DELETE" }, "alice");
    for (const postId of ["post-1", "post-2", "post-4"]) {
      const res = await api(`/posts/${postId}/save`, { method: "POST" }, "alice");
      expect(res.status).toBe(200);
    }

    const page1 = await (await api("/saved-posts?page=1&limit=2", {}, "alice")).json();
    expect(page1.items).toHaveLength(2);
    expect(page1.totalCount).toBe(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await (await api("/saved-posts?page=2&limit=2", {}, "alice")).json();
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    const ids = new Set([...page1.items, ...page2.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(3);
  });
});

describe("moderation", () => {
  it("student cannot remove a post; moderator can; removed post vanishes everywhere", async () => {
    // dana (student) has post-5 actively saved from seed.
    let res = await api("/posts/post-5", { method: "DELETE" }, "dana");
    expect(res.status).toBe(403);

    res = await api("/posts/post-5", { method: "DELETE" }, "carol");
    expect(res.status).toBe(200);

    // Gone from the course feed…
    res = await api("/courses/course-202/posts", {}, "alice");
    const feed = await res.json();
    expect(feed.items.map((i: { id: string }) => i.id)).not.toContain("post-5");

    // …gone from dana's saved list (her save row still exists, soft-preserved)…
    res = await api("/saved-posts", {}, "dana");
    const list = await res.json();
    expect(list.items.map((i: { id: string }) => i.id)).not.toContain("post-5");

    // …and any further operation on it 404s.
    res = await api("/posts/post-5/save", { method: "POST" }, "dana");
    expect(res.status).toBe(404);
  });
});
