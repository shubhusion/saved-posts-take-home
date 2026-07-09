/**
 * Pure state-transition logic for the bookmark lifecycle.
 *
 * This module is deliberately free of I/O so the assignment's core business
 * rules — idempotency, reactivation, history preservation — are testable
 * without a database. The service layer maps these intents onto repository
 * calls; the database's composite PK + ON CONFLICT upsert then guarantees the
 * same invariants hold under concurrency (see savedPosts.repo.ts).
 */

export interface SaveState {
  /** null = user has never saved this post */
  savedAt: Date;
  /** non-null = save was soft-deleted (unsaved) */
  deletedAt: Date | null;
}

export type SaveIntent =
  | { action: "create" } // first ever save -> insert new row
  | { action: "reactivate" } // was unsaved -> clear deleted_at, bump saved_at
  | { action: "noop" }; // already actively saved -> idempotent no-op

export type UnsaveIntent =
  | { action: "deactivate" } // actively saved -> set deleted_at
  | { action: "noop" }; // never saved, or already unsaved

export function resolveSave(existing: SaveState | null): SaveIntent {
  if (existing === null) return { action: "create" };
  if (existing.deletedAt !== null) return { action: "reactivate" };
  return { action: "noop" };
}

export function resolveUnsave(existing: SaveState | null): UnsaveIntent {
  if (existing === null || existing.deletedAt !== null) return { action: "noop" };
  return { action: "deactivate" };
}
