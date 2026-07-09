import type {
  makeCoursesRepo,
  makePostsRepo,
  makeSavedPostsRepo,
  makeUsersRepo,
} from "../repositories/repositories";

/**
 * Services depend on these interfaces, not on Drizzle. The dependency arrow
 * points inward (repositories implement what services need), which is what
 * lets the unit tests in tests/unit run against in-memory fakes with no
 * database at all.
 *
 * Deriving the types from the factory return values keeps the contract in one
 * place without hand-maintaining parallel interface declarations.
 */
export type UsersRepo = ReturnType<typeof makeUsersRepo>;
export type CoursesRepo = ReturnType<typeof makeCoursesRepo>;
export type PostsRepo = ReturnType<typeof makePostsRepo>;
export type SavedPostsRepo = ReturnType<typeof makeSavedPostsRepo>;

export interface Repos {
  users: UsersRepo;
  courses: CoursesRepo;
  posts: PostsRepo;
  savedPosts: SavedPostsRepo;
}
