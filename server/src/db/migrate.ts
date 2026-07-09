import { createDb } from "./client";

const db = createDb();

// The two backends need their own migrator function (same generated SQL
// either way — see server/drizzle/ — this only picks how it's applied).
if (process.env.USE_PGLITE === "1") {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
} else {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
}

console.log(`Migrations applied${process.env.USE_PGLITE === "1" ? " (PGlite)" : ""}`);
process.exit(0);
