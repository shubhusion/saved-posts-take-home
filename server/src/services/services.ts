import { forbidden, notFound } from "../domain/errors";
import { resolveSave, resolveUnsave } from "../domain/savedPostTransitions";
import type { Role, UserRow } from "../db/schema";
import type { Repos } from "./ports";

/**
 * Services are where decisions happen: authorization, idempotency semantics,
 * and workflow. They speak in domain errors (never HTTP) and in repository
 * ports (never SQL).
 */

export interface Viewer {
  id: string;
  role: Role;
}

/**
 * Central access rule: may this viewer see posts in this course?
 * Students: only if enrolled. Moderators: always (spec: "see any post").
 * Kept as one function so the rule cannot drift between feed and save paths.
 */
async function assertCourseAccess(repos: Repos, viewer: Viewer, courseId: string): Promise<void> {
  if (viewer.role === "moderator") return;
  const enrolled = await repos.courses.isEnrolled(viewer.id, courseId);
  if (!enrolled) throw forbidden("You are not enrolled in this course");
}

/**
 * Shared lookup used by every per-post operation. Order matters and is
 * deliberate:
 *   1. missing OR soft-deleted post -> 404 (a removed post is gone, full stop)
 *   2. not allowed to see its course -> 403 (spec mandates 403 here; we accept
 *      the "course exists + you're excluded" information leak because the
 *      spec explicitly asks for it — see NOTES.md for the 404-alternative
 *      discussion)
 */
async function getAccessiblePost(repos: Repos, viewer: Viewer, postId: string) {
  const post = await repos.posts.findById(postId);
  if (!post || post.deletedAt !== null) throw notFound("Post not found");
  await assertCourseAccess(repos, viewer, post.courseId);
  return post;
}

export function makeFeedService(repos: Repos) {
  return {
    async getCourseFeed(viewer: Viewer, courseId: string, page: number, limit: number) {
      const course = await repos.courses.findById(courseId);
      if (!course) throw notFound("Course not found");
      await assertCourseAccess(repos, viewer, courseId);
      return repos.posts.listByCourse(courseId, viewer.id, page, limit);
    },
  };
}

export function makeSavedPostsService(repos: Repos) {
  return {
    /**
     * Idempotent save. The pure transition function decides what this request
     * means given current state; only state-changing intents touch the
     * database, and the write itself is an ON CONFLICT upsert so concurrent
     * duplicates converge on the same single active row (see repo docs).
     */
    async save(viewer: Viewer, postId: string) {
      const post = await getAccessiblePost(repos, viewer, postId);

      const existing = await repos.savedPosts.find(viewer.id, postId);
      const intent = resolveSave(existing);
      if (intent.action !== "noop") {
        await repos.savedPosts.upsertActiveSave(viewer.id, postId);
      }

      return {
        hasSaved: true,
        savesCount: await repos.savedPosts.countActiveForPost(post.id),
      };
    },

    /** Idempotent unsave: soft delete; never destroys the row. */
    async unsave(viewer: Viewer, postId: string) {
      const post = await getAccessiblePost(repos, viewer, postId);

      const existing = await repos.savedPosts.find(viewer.id, postId);
      const intent = resolveUnsave(existing);
      if (intent.action !== "noop") {
        await repos.savedPosts.deactivateSave(viewer.id, postId);
      }

      return {
        hasSaved: false,
        savesCount: await repos.savedPosts.countActiveForPost(post.id),
      };
    },

    /**
     * The "OWN" rule is structural: this always reads the AUTHENTICATED
     * user's list. There is no parameter through which one user could name
     * another user's list, so the rule cannot be violated by input.
     */
    async listMine(viewer: Viewer, page: number, limit: number) {
      return repos.savedPosts.listActiveByUser(viewer.id, page, limit);
    },
  };
}

export function makeModerationService(repos: Repos) {
  return {
    /**
     * Moderator removal = soft delete of the post. Save rows are untouched
     * (history preserved); list queries filter removed posts out.
     */
    async removePost(viewer: Viewer, postId: string) {
      if (viewer.role !== "moderator") {
        throw forbidden("Only moderators can remove posts");
      }
      const post = await repos.posts.findById(postId);
      if (!post || post.deletedAt !== null) throw notFound("Post not found");
      await repos.posts.softDelete(postId);
      return { removed: true as const };
    },
  };
}

export function makeMeService(repos: Repos) {
  return {
    /** Viewer identity + the courses they may browse (drives the UI course selector). */
    async getProfile(user: UserRow) {
      const accessibleCourses =
        user.role === "moderator"
          ? await repos.courses.listAll()
          : await repos.courses.listEnrolledCourses(user.id);
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        courses: accessibleCourses.map((c) => ({ id: c.id, title: c.title })),
      };
    },
  };
}
