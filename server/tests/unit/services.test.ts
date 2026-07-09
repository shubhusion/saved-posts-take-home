import { beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors";
import type { Repos } from "../../src/services/ports";
import {
  makeFeedService,
  makeModerationService,
  makeSavedPostsService,
  type Viewer,
} from "../../src/services/services";

/**
 * Services are tested against an in-memory fake that implements the
 * repository ports. This proves the DECISIONS (authorization, idempotent
 * semantics, reactivation) independently of SQL; the integration test then
 * proves the same behaviour through the real HTTP + Postgres path.
 */

interface FakeSave {
  userId: string;
  postId: string;
  savedAt: Date;
  deletedAt: Date | null;
}

function makeWorld() {
  const now = () => new Date();
  const users = new Map([
    ["alice", { id: "alice", name: "Alice", role: "student" as const, createdAt: now() }],
    ["carol", { id: "carol", name: "Carol", role: "moderator" as const, createdAt: now() }],
  ]);
  const enrollments = new Set(["alice:course-101"]);
  const posts = new Map([
    ["post-1", { id: "post-1", courseId: "course-101", authorId: "alice", title: "t", content: "c", createdAt: now(), deletedAt: null as Date | null }],
    ["post-9", { id: "post-9", courseId: "course-202", authorId: "alice", title: "t", content: "c", createdAt: now(), deletedAt: null as Date | null }],
  ]);
  const saves: FakeSave[] = [];

  const findSave = (u: string, p: string) => saves.find((s) => s.userId === u && s.postId === p) ?? null;

  const repos: Repos = {
    users: {
      findById: async (id) => users.get(id) ?? null,
      listAll: async () => [...users.values()],
    },
    courses: {
      findById: async (id) =>
        ["course-101", "course-202"].includes(id) ? { id, title: id, createdAt: now() } : null,
      listAll: async () => [],
      listEnrolledCourses: async () => [],
      isEnrolled: async (u, c) => enrollments.has(`${u}:${c}`),
    },
    posts: {
      findById: async (id) => posts.get(id) ?? null,
      listByCourse: async () => ({ items: [], page: 1, limit: 10, totalCount: 0, hasMore: false }),
      softDelete: async (id) => {
        const p = posts.get(id);
        if (p) p.deletedAt = new Date();
      },
    },
    savedPosts: {
      find: async (u, p) => findSave(u, p),
      // Fake mirrors the SQL upsert's contract: create or reactivate, never duplicate.
      upsertActiveSave: async (u, p) => {
        const existing = findSave(u, p);
        if (existing) {
          if (existing.deletedAt !== null) {
            existing.deletedAt = null;
            existing.savedAt = new Date();
          }
        } else {
          saves.push({ userId: u, postId: p, savedAt: new Date(), deletedAt: null });
        }
      },
      deactivateSave: async (u, p) => {
        const existing = findSave(u, p);
        if (existing && existing.deletedAt === null) existing.deletedAt = new Date();
      },
      countActiveForPost: async (p) =>
        saves.filter((s) => s.postId === p && s.deletedAt === null).length,
      listActiveByUser: async () => ({ items: [], page: 1, limit: 10, totalCount: 0, hasMore: false }),
    },
  };

  return { repos, saves };
}

const alice: Viewer = { id: "alice", role: "student" };
const carol: Viewer = { id: "carol", role: "moderator" };

describe("SavedPostsService.save", () => {
  let world: ReturnType<typeof makeWorld>;
  beforeEach(() => {
    world = makeWorld();
  });

  it("saves an accessible post and reports the new state", async () => {
    const svc = makeSavedPostsService(world.repos);
    const res = await svc.save(alice, "post-1");
    expect(res).toEqual({ hasSaved: true, savesCount: 1 });
  });

  it("is idempotent: double save is a no-op, not a double count", async () => {
    const svc = makeSavedPostsService(world.repos);
    await svc.save(alice, "post-1");
    const res = await svc.save(alice, "post-1");
    expect(res.savesCount).toBe(1);
    expect(world.saves).toHaveLength(1);
  });

  it("reactivates the same row on re-save and bumps savedAt", async () => {
    const svc = makeSavedPostsService(world.repos);
    await svc.save(alice, "post-1");
    const firstSavedAt = world.saves[0]!.savedAt;
    await svc.unsave(alice, "post-1");
    expect(world.saves[0]!.deletedAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    const res = await svc.save(alice, "post-1");

    expect(world.saves).toHaveLength(1); // same row, no duplicate
    expect(world.saves[0]!.deletedAt).toBeNull();
    expect(world.saves[0]!.savedAt.getTime()).toBeGreaterThan(firstSavedAt.getTime());
    expect(res).toEqual({ hasSaved: true, savesCount: 1 });
  });

  it("403s a student saving a post in a course they are not enrolled in", async () => {
    const svc = makeSavedPostsService(world.repos);
    await expect(svc.save(alice, "post-9")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a moderator save any post (enrollment bypass)", async () => {
    const svc = makeSavedPostsService(world.repos);
    const res = await svc.save(carol, "post-9");
    expect(res.hasSaved).toBe(true);
  });

  it("404s an unknown post", async () => {
    const svc = makeSavedPostsService(world.repos);
    await expect(svc.save(alice, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("SavedPostsService.unsave", () => {
  it("soft-deletes without destroying the row, and is idempotent", async () => {
    const world = makeWorld();
    const svc = makeSavedPostsService(world.repos);
    await svc.save(alice, "post-1");

    const first = await svc.unsave(alice, "post-1");
    expect(first).toEqual({ hasSaved: false, savesCount: 0 });
    expect(world.saves).toHaveLength(1); // history preserved

    const second = await svc.unsave(alice, "post-1"); // no-op
    expect(second).toEqual({ hasSaved: false, savesCount: 0 });
  });

  it("unsaving a never-saved post is a no-op, not an error", async () => {
    const world = makeWorld();
    const svc = makeSavedPostsService(world.repos);
    const res = await svc.unsave(alice, "post-1");
    expect(res).toEqual({ hasSaved: false, savesCount: 0 });
  });
});

describe("FeedService authorization", () => {
  it("403s a student reading a course they are not enrolled in", async () => {
    const { repos } = makeWorld();
    const svc = makeFeedService(repos);
    await expect(svc.getCourseFeed(alice, "course-202", 1, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s an unknown course before leaking anything else", async () => {
    const { repos } = makeWorld();
    const svc = makeFeedService(repos);
    await expect(svc.getCourseFeed(alice, "course-999", 1, 10)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ModerationService.removePost", () => {
  it("403s a student attempting removal", async () => {
    const { repos } = makeWorld();
    const svc = makeModerationService(repos);
    await expect(svc.removePost(alice, "post-1")).rejects.toBeInstanceOf(DomainError);
    await expect(svc.removePost(alice, "post-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a moderator soft-delete, after which the post 404s", async () => {
    const { repos } = makeWorld();
    const moderation = makeModerationService(repos);
    const saved = makeSavedPostsService(repos);

    await moderation.removePost(carol, "post-1");
    // Deleted posts are gone for every subsequent operation:
    await expect(saved.save(alice, "post-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(moderation.removePost(carol, "post-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
