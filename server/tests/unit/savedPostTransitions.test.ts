import { describe, expect, it } from "vitest";
import { resolveSave, resolveUnsave } from "../../src/domain/savedPostTransitions";

/**
 * The assignment asks whether "idempotency, count behaviour, and reactivation
 * live in code you can test without a database". This file is the answer:
 * pure functions, no mocks, no I/O.
 */

const active = { savedAt: new Date("2026-01-01"), deletedAt: null };
const inactive = { savedAt: new Date("2026-01-01"), deletedAt: new Date("2026-01-02") };

describe("resolveSave", () => {
  it("creates a new save when the user has never saved the post", () => {
    expect(resolveSave(null)).toEqual({ action: "create" });
  });

  it("reactivates the existing row after an unsave (never a duplicate)", () => {
    expect(resolveSave(inactive)).toEqual({ action: "reactivate" });
  });

  it("is a no-op when the post is already actively saved (idempotency)", () => {
    expect(resolveSave(active)).toEqual({ action: "noop" });
  });
});

describe("resolveUnsave", () => {
  it("deactivates an active save (soft delete)", () => {
    expect(resolveUnsave(active)).toEqual({ action: "deactivate" });
  });

  it("is a no-op when the post was never saved", () => {
    expect(resolveUnsave(null)).toEqual({ action: "noop" });
  });

  it("is a no-op when the save is already soft-deleted (idempotency)", () => {
    expect(resolveUnsave(inactive)).toEqual({ action: "noop" });
  });
});
