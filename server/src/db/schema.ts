import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Roles are a column, not a table: the assignment defines exactly two roles
 * with a strict superset relationship, so an enum-like text column keeps the
 * model honest without premature RBAC machinery.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role", { enum: ["student", "moderator"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Many-to-many User <-> Course. Pure join table, composite PK. */
export const enrollments = pgTable(
  "enrollments",
  {
    userId: text("user_id").notNull().references(() => users.id),
    courseId: text("course_id").notNull().references(() => courses.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] })],
);

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    courseId: text("course_id").notNull().references(() => courses.id),
    authorId: text("author_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: moderator "remove" sets this; feed/saved queries filter it. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  // Feed query is (course_id, deleted_at IS NULL) ordered by created_at DESC.
  (t) => [index("posts_course_created_idx").on(t.courseId, t.createdAt)],
);

/**
 * The bookmark relationship. One row per (user, post) — ever.
 *
 * The composite primary key is the concurrency story: no matter how the
 * application races, the database cannot hold two save rows for the same
 * (user, post). "Save state" is a toggle on this row:
 *   - active save:   deleted_at IS NULL
 *   - unsaved (history preserved): deleted_at set
 * Re-saving reactivates the SAME row (deleted_at -> NULL, saved_at bumped),
 * which is what makes "most-recently-saved first" ordering correct.
 */
export const savedPosts = pgTable(
  "saved_posts",
  {
    userId: text("user_id").notNull().references(() => users.id),
    postId: text("post_id").notNull().references(() => posts.id),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    // Saved-list query: WHERE user_id = ? AND deleted_at IS NULL ORDER BY saved_at DESC.
    index("saved_posts_user_active_idx").on(t.userId, t.deletedAt, t.savedAt),
    // savesCount aggregation per post.
    index("saved_posts_post_active_idx").on(t.postId, t.deletedAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type SavedPostRow = typeof savedPosts.$inferSelect;
export type Role = UserRow["role"];
