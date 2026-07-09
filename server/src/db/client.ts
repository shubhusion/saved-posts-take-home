import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * All repositories and services are written against this driver-agnostic
 * Drizzle type. Two backends implement it:
 *
 *  - postgres.js against a real Postgres (Docker Compose) — the default,
 *    and what you'd run in production.
 *  - PGlite, an in-process WASM build of actual Postgres (not a different
 *    dialect like SQLite), persisted to a data directory on disk. Set
 *    USE_PGLITE=1 to use this instead — it's how the integration tests run
 *    (in-memory), and it's also a legitimate Docker-free way to run the dev
 *    server itself, since it IS Postgres, just embedded.
 *
 * The `any` on the query-result HKT is deliberate: it is the one seam where
 * the two drivers' result-shape generics diverge, and widening it here keeps
 * every downstream layer driver-agnostic without casts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, typeof schema>;

export function createDb(): DB {
  if (process.env.USE_PGLITE === "1") {
    const dataDir = process.env.PGLITE_DATA_DIR ?? "./.pglite-data";
    const client = new PGlite(dataDir);
    return drizzlePglite(client, { schema }) as unknown as DB;
  }

  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/saved_posts";
  const client = postgres(url);
  return drizzlePg(client, { schema });
}

