import { treaty } from "@elysiajs/eden";
import type { App } from "server";

/**
 * Eden Treaty derives the ENTIRE client contract — paths, params, bodies,
 * response shapes — from the server's Elysia `App` type. There is no
 * hand-written DTO layer to drift out of sync: if the server changes a
 * response shape, the web app fails to typecheck.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * The stubbed identity. A module-level variable (synced to localStorage by
 * the user switcher) keeps the treaty client a singleton while letting the
 * dev user switcher change who every subsequent request authenticates as.
 */
let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null) {
  currentUserId = id;
}

export const api = treaty<App>(BASE_URL, {
  headers: () => (currentUserId ? { "x-user-id": currentUserId } : {}),
});

/**
 * Query-key factory: every cache key in the app is minted here, so
 * invalidation code can never typo a key. Keys are hierarchical —
 * invalidating `keys.feeds()` hits every course/page combination.
 */
export const keys = {
  devUsers: ["dev-users"] as const,
  me: (userId: string) => ["me", userId] as const,
  feeds: () => ["feed"] as const,
  feed: (courseId: string, page: number) => ["feed", courseId, page] as const,
  savedLists: () => ["saved"] as const,
  savedList: (page: number) => ["saved", page] as const,
};

/**
 * Shared view types, hand-declared rather than inferred from the treaty
 * call's return type. Elysia's global `.onError` handler widens every
 * route's inferred 200-response type to a union with the error shape (there
 * is no per-route way to exclude it from inference), so deriving these via
 * `ReturnType<...>` pulls that union in and loses field access. Declaring
 * them here instead mirrors the repository layer's `PostView`/`SavedPostView`
 * (see server/src/repositories/repositories.ts) — the two are meant to be
 * the same shape by construction, and a mismatch would fail at the call
 * sites that read these fields, which is a perfectly good tripwire.
 */
export interface PostView {
  id: string;
  courseId: string;
  courseTitle: string;
  authorName: string;
  title: string;
  content: string;
  createdAt: string;
  savesCount: number;
  hasSaved: boolean;
}

export interface SavedPostView extends PostView {
  savedAt: string;
}

export interface Profile {
  id: string;
  name: string;
  role: "student" | "moderator";
  courses: { id: string; title: string }[];
}

export interface DevUser {
  id: string;
  name: string;
  role: "student" | "moderator";
}

export type PageOf<T> = {
  items: T[];
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
};

