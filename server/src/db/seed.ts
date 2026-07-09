import { createDb, type DB } from "./client";
import { courses, enrollments, posts, savedPosts, users } from "./schema";

/**
 * Deterministic seed with fixed IDs so the README's curl examples are
 * copy-pasteable. Exported so integration tests seed the exact same world.
 *
 * The world:
 *   - course-101 "Distributed Systems": alice + bob enrolled
 *   - course-202 "Databases":           alice + dana enrolled
 *   - carol is a moderator (enrolled nowhere; role bypasses enrollment)
 *   - bob has pre-saved one post; one of his saves is soft-deleted (history)
 */
export async function seed(db: DB) {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

  await db.insert(users).values([
    { id: "alice", name: "Alice Kumar", role: "student" },
    { id: "bob", name: "Bob Fernandes", role: "student" },
    { id: "dana", name: "Dana Iyer", role: "student" },
    { id: "carol", name: "Carol Mendes", role: "moderator" },
  ]);

  await db.insert(courses).values([
    { id: "course-101", title: "Distributed Systems" },
    { id: "course-202", title: "Databases" },
  ]);

  await db.insert(enrollments).values([
    { userId: "alice", courseId: "course-101" },
    { userId: "alice", courseId: "course-202" },
    { userId: "bob", courseId: "course-101" },
    { userId: "dana", courseId: "course-202" },
  ]);

  await db.insert(posts).values([
    { id: "post-1", courseId: "course-101", authorId: "bob", title: "Why is consensus hard?", content: "I read the Raft paper and I still don't get leader election edge cases. Anyone have a good mental model?", createdAt: at(6) },
    { id: "post-2", courseId: "course-101", authorId: "alice", title: "Vector clocks vs Lamport clocks", content: "Summary of the differences with examples from the lecture, plus where each breaks down.", createdAt: at(5) },
    { id: "post-3", courseId: "course-101", authorId: "bob", title: "Lab 2 test harness tips", content: "The flaky test is usually a timeout issue. Bump the heartbeat interval before debugging anything else.", createdAt: at(3) },
    { id: "post-4", courseId: "course-101", authorId: "alice", title: "Study group for the midterm?", content: "Thinking Tuesday evenings in the library. Reply if interested.", createdAt: at(1) },
    { id: "post-5", courseId: "course-202", authorId: "alice", title: "B-tree vs LSM-tree write paths", content: "Notes comparing write amplification, with diagrams from the textbook chapter 3.", createdAt: at(4) },
    { id: "post-6", courseId: "course-202", authorId: "dana", title: "Normalization cheat sheet", content: "1NF through BCNF with one worked example each. Corrections welcome.", createdAt: at(2) },
    { id: "post-7", courseId: "course-202", authorId: "dana", title: "Query planner surprises", content: "EXPLAIN ANALYZE showed a seq scan where I expected an index scan — turns out stats were stale.", createdAt: at(0.5) },
  ]);

  await db.insert(savedPosts).values([
    // bob actively saved alice's clocks post
    { userId: "bob", postId: "post-2", savedAt: at(2) },
    // bob saved then UNSAVED the harness post: history row, soft-deleted
    { userId: "bob", postId: "post-3", savedAt: at(3), deletedAt: at(1) },
    // dana actively saved a Databases post
    { userId: "dana", postId: "post-5", savedAt: at(1) },
  ]);
}

if (import.meta.main) {
  const db = createDb();
  await seed(db);
  console.log("Seed data inserted");
  process.exit(0);
}
