/**
 * Lightweight migration runner for Docker.
 * Reads drizzle-kit's _journal.json and applies pending SQL migrations
 * using the postgres driver — no drizzle-kit dependency needed at runtime.
 *
 * Compatible with drizzle-orm's migration tracking:
 * - Uses "drizzle" schema and "__drizzle_migrations" table
 * - Stores SHA-256 hash of migration SQL content
 * - Compares by created_at timestamp ordering
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  // Match drizzle-orm's schema and table structure exactly
  await sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `;

  // Get the latest applied migration timestamp (matches drizzle-orm's approach)
  const [lastMigration] = await sql`
    SELECT created_at FROM "drizzle"."__drizzle_migrations"
    ORDER BY created_at DESC LIMIT 1
  `;
  const lastTimestamp = lastMigration ? Number(lastMigration.created_at) : 0;

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));

  for (const entry of journal.entries) {
    if (entry.when <= lastTimestamp) continue;

    const filePath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    const migrationSql = readFileSync(filePath, "utf-8");
    const hash = createHash("sha256").update(migrationSql).digest("hex");

    // Split on breakpoints (drizzle convention: --> statement-breakpoint)
    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
      await tx`
        INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
        VALUES (${hash}, ${entry.when})
      `;
    });

    console.log(`Applied migration: ${entry.tag}`);
  }

  console.log("Migrations complete.");
} finally {
  await sql.end();
}
