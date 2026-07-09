import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { courses, enrollments, posts, savedPosts, users } from "../db/schema";

/**
 * Repositories return facts; services make decisions.
 *
 * Every function here is a straight question to the database ("what exists?",
 * "write this row") with zero authorization or workflow logic. Services own
 * the rules; this file owns the SQL. The interfaces are defined by the
 * service layer (see services/ports.ts) so services can be unit-tested
 * against in-memory fakes.
 */

/** A post as the client sees it: hydrated with per-viewer flags. */
export interface PostView {
  id: string;
  courseId: string;
  courseTitle: string;
  authorName: string;
  title: string;
  content: string;
  createdAt: Date;
  savesCount: number;
  hasSaved: boolean;
}

export interface SavedPostView extends PostView {
  savedAt: Date;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

/**
 * The per-viewer flag expressions, computed IN the list query itself.
 * One round trip for N posts — this is the answer to the assignment's
 * "how do you fetch hasSaved / savesCount for a list efficiently?".
 *
 *  - savesCount: correlated COUNT over active saves for the row's post.
 *  - hasSaved:   EXISTS over the viewer's own active save.
 *
 * Both are computed, never stored: a denormalized counter is faster to read
 * but becomes a correctness liability under concurrent save/unsave. At this
 * scale COUNT-on-read is correct by construction. (Scaling path: counter
 * column maintained in the same transaction + periodic reconciliation.)
 */
const savesCountExpr = sql<number>`(
  select count(*)::int from ${savedPosts} sp
  where sp.post_id = ${posts.id} and sp.deleted_at is null
)`;

const hasSavedExpr = (viewerId: string) => sql<boolean>`exists(
  select 1 from ${savedPosts} sp
  where sp.post_id = ${posts.id} and sp.user_id = ${viewerId} and sp.deleted_at is null
)`;

const postViewColumns = (viewerId: string) => ({
  id: posts.id,
  courseId: posts.courseId,
  courseTitle: courses.title,
  authorName: users.name,
  title: posts.title,
  content: posts.content,
  createdAt: posts.createdAt,
  savesCount: savesCountExpr,
  hasSaved: hasSavedExpr(viewerId),
});

// ---------------------------------------------------------------------------
// Users / courses / enrollments
// ---------------------------------------------------------------------------

export function makeUsersRepo(db: DB) {
  return {
    async findById(id: string) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ?? null;
    },
    /** Dev-only helper backing the UI user switcher. */
    async listAll() {
      return db.select().from(users).orderBy(users.role, users.id);
    },
  };
}

export function makeCoursesRepo(db: DB) {
  return {
    async findById(id: string) {
      const rows = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async listAll() {
      return db.select().from(courses).orderBy(courses.id);
    },
    async listEnrolledCourses(userId: string) {
      return db
        .select({ id: courses.id, title: courses.title })
        .from(enrollments)
        .innerJoin(courses, eq(enrollments.courseId, courses.id))
        .where(eq(enrollments.userId, userId))
        .orderBy(courses.id);
    },
    async isEnrolled(userId: string, courseId: string) {
      const rows = await db
        .select({ one: sql`1` })
        .from(enrollments)
        .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
        .limit(1);
      return rows.length > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export function makePostsRepo(db: DB) {
  return {
    /** Returns the post even if soft-deleted; the service decides what a deleted post means per use case. */
    async findById(id: string) {
      const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Course feed, newest first, hydrated flags, offset-paginated. */
    async listByCourse(courseId: string, viewerId: string, page: number, limit: number): Promise<Page<PostView>> {
      const where = and(eq(posts.courseId, courseId), isNull(posts.deletedAt));

      const [items, totals] = await Promise.all([
        db
          .select(postViewColumns(viewerId))
          .from(posts)
          .innerJoin(courses, eq(posts.courseId, courses.id))
          .innerJoin(users, eq(posts.authorId, users.id))
          .where(where)
          .orderBy(desc(posts.createdAt), desc(posts.id))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ value: count() }).from(posts).where(where),
      ]);

      const totalCount = totals[0]?.value ?? 0;
      return { items, page, limit, totalCount, hasMore: page * limit < totalCount };
    },

    async softDelete(id: string) {
      await db
        .update(posts)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(posts.id, id), isNull(posts.deletedAt)));
    },
  };
}

// ---------------------------------------------------------------------------
// Saved posts
// ---------------------------------------------------------------------------

export function makeSavedPostsRepo(db: DB) {
  return {
    async find(userId: string, postId: string) {
      const rows = await db
        .select()
        .from(savedPosts)
        .where(and(eq(savedPosts.userId, userId), eq(savedPosts.postId, postId)))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Race-safe save. The service has already decided (via the pure transition
     * function) that a write is needed; this upsert makes that write correct
     * even if two identical requests race past the service's read:
     *
     *   INSERT ... ON CONFLICT (user_id, post_id)
     *   DO UPDATE SET saved_at = now(), deleted_at = NULL
     *   WHERE saved_posts.deleted_at IS NOT NULL
     *
     * The WHERE clause means a conflicting row that is ALREADY active is left
     * completely untouched — so a racing duplicate save cannot bump saved_at
     * and silently reorder the user's saved list. Idempotency is therefore
     * enforced twice: behaviorally in testable code, and physically by the
     * composite PK at the storage layer.
     */
    async upsertActiveSave(userId: string, postId: string) {
      await db
        .insert(savedPosts)
        .values({ userId, postId, savedAt: sql`now()` })
        .onConflictDoUpdate({
          target: [savedPosts.userId, savedPosts.postId],
          set: { savedAt: sql`now()`, deletedAt: null },
          setWhere: sql`${savedPosts.deletedAt} is not null`,
        });
    },

    /** Soft delete. Only flips active rows, so it is inherently idempotent. */
    async deactivateSave(userId: string, postId: string) {
      await db
        .update(savedPosts)
        .set({ deletedAt: sql`now()` })
        .where(
          and(
            eq(savedPosts.userId, userId),
            eq(savedPosts.postId, postId),
            isNull(savedPosts.deletedAt),
          ),
        );
    },

    async countActiveForPost(postId: string) {
      const rows = await db
        .select({ value: count() })
        .from(savedPosts)
        .where(and(eq(savedPosts.postId, postId), isNull(savedPosts.deletedAt)));
      return rows[0]?.value ?? 0;
    },

    /**
     * The viewer's saved list, most-recently-saved first. Soft-deleted POSTS
     * are filtered out too: a moderator-removed post should not linger in
     * anyone's saved list (the save row itself is untouched — history intact).
     */
    async listActiveByUser(userId: string, page: number, limit: number): Promise<Page<SavedPostView>> {
      const where = and(
        eq(savedPosts.userId, userId),
        isNull(savedPosts.deletedAt),
        isNull(posts.deletedAt),
      );

      const [items, totals] = await Promise.all([
        db
          .select({ ...postViewColumns(userId), savedAt: savedPosts.savedAt })
          .from(savedPosts)
          .innerJoin(posts, eq(savedPosts.postId, posts.id))
          .innerJoin(courses, eq(posts.courseId, courses.id))
          .innerJoin(users, eq(posts.authorId, users.id))
          .where(where)
          .orderBy(desc(savedPosts.savedAt), desc(savedPosts.postId))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ value: count() })
          .from(savedPosts)
          .innerJoin(posts, eq(savedPosts.postId, posts.id))
          .where(where),
      ]);

      const totalCount = totals[0]?.value ?? 0;
      return { items, page, limit, totalCount, hasMore: page * limit < totalCount };
    },
  };
}
