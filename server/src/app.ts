import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { z } from "zod";
import type { DB } from "./db/client";
import { DomainError, unauthenticated } from "./domain/errors";
import {
  makeCoursesRepo,
  makePostsRepo,
  makeSavedPostsRepo,
  makeUsersRepo,
} from "./repositories/repositories";
import type { Repos } from "./services/ports";
import {
  makeFeedService,
  makeMeService,
  makeModerationService,
  makeSavedPostsService,
} from "./services/services";

/**
 * The HTTP layer does three jobs and nothing else:
 *   1. authenticate the request (resolve x-user-id -> a real user),
 *   2. validate input shape (Zod),
 *   3. translate service results / domain errors into HTTP.
 * No business rules live here — the controller cannot even express
 * "is enrolled", it can only ask services.
 */

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * IDs here are opaque strings (e.g. "post-1"), never parsed or used to
 * construct anything — this is defense-in-depth against junk input reaching
 * the DB, not a format contract. A malformed ID still just 404s.
 */
const idParamSchema = z.string().trim().min(1).max(100);

const statusFor: Record<DomainError["code"], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

/**
 * App factory takes the DB so integration tests can hand it an in-process
 * PGlite instance and drive the real HTTP surface via app.handle(Request).
 */
export function createApp(db: DB) {
  const repos: Repos = {
    users: makeUsersRepo(db),
    courses: makeCoursesRepo(db),
    posts: makePostsRepo(db),
    savedPosts: makeSavedPostsRepo(db),
  };

  const feed = makeFeedService(repos);
  const saved = makeSavedPostsService(repos);
  const moderation = makeModerationService(repos);
  const me = makeMeService(repos);

  return (
    new Elysia()
      .use(cors({ origin: true, allowedHeaders: ["content-type", "x-user-id"] }))
      .onError(({ error, set }) => {
        if (error instanceof DomainError) {
          set.status = statusFor[error.code];
          return { error: { code: error.code, message: error.message } };
        }
        if (error instanceof z.ZodError) {
          set.status = 400;
          return { error: { code: "BAD_REQUEST", message: error.issues[0]?.message ?? "Invalid input" } };
        }
        set.status = 500;
        return { error: { code: "INTERNAL", message: "Something went wrong" } };
      })

      // ----- Dev-only, unauthenticated: powers the UI user switcher. -------
      // Not a forum endpoint; it stands in for the login screen the spec
      // says not to build. Would not ship to production.
      .get("/dev/users", async () => {
        const users = await repos.users.listAll();
        return users.map((u) => ({ id: u.id, name: u.name, role: u.role }));
      })

      // ----- Authentication boundary. --------------------------------------
      // The stub reads ONLY the user's identity from the header; the role is
      // loaded from the database. Clients never assert their own role — the
      // stub replaces authentication, not authorization, so swapping it for
      // a verified JWT later changes nothing downstream.
      .resolve(async ({ headers }) => {
        const userId = headers["x-user-id"];
        if (!userId) throw unauthenticated("Missing x-user-id header");
        const user = await repos.users.findById(userId);
        if (!user) throw unauthenticated("Unknown user");
        return { viewer: { id: user.id, role: user.role }, user };
      })

      // ----- Forum endpoints (all require auth from here down). -----------
      .get("/me", ({ user }) => me.getProfile(user))

      .get("/courses/:courseId/posts", ({ viewer, params, query }) => {
        const { page, limit } = paginationSchema.parse(query);
        const courseId = idParamSchema.parse(params.courseId);
        return feed.getCourseFeed(viewer, courseId, page, limit);
      })

      .post("/posts/:postId/save", ({ viewer, params }) =>
        saved.save(viewer, idParamSchema.parse(params.postId)),
      )

      .delete("/posts/:postId/save", ({ viewer, params }) =>
        saved.unsave(viewer, idParamSchema.parse(params.postId)),
      )

      .get("/saved-posts", ({ viewer, query }) => {
        const { page, limit } = paginationSchema.parse(query);
        return saved.listMine(viewer, page, limit);
      })

      .delete("/posts/:postId", ({ viewer, params }) =>
        moderation.removePost(viewer, idParamSchema.parse(params.postId)),
      )
  );
}

/** Exported for Eden Treaty: the web app derives its typed client from this. */
export type App = ReturnType<typeof createApp>;
