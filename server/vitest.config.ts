import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // PGlite + migrations are quick, but give slow CI machines headroom.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
