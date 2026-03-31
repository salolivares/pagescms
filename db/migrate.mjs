/**
 * Lightweight migration runner for Docker.
 * Reads drizzle-kit's _journal.json and applies pending SQL migrations
 * using the postgres driver — no drizzle-kit dependency needed at runtime.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");
const JOURNAL_PATH = join(MIGRATIONS_DIR, "meta", "_journal.json");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  // Ensure the drizzle migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `;

  const applied = new Set(
    (await sql`SELECT hash FROM "__drizzle_migrations"`).map((r) => r.hash)
  );

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8"));

  for (const entry of journal.entries) {
    if (applied.has(entry.tag)) continue;

    const filePath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    const migration = readFileSync(filePath, "utf-8");

    // Split on breakpoints (drizzle convention: --> statement-breakpoint)
    const statements = migration
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
      await tx`
        INSERT INTO "__drizzle_migrations" (hash, created_at)
        VALUES (${entry.tag}, ${entry.when})
      `;
    });

    console.log(`Applied migration: ${entry.tag}`);
  }

  console.log("Migrations complete.");
} finally {
  await sql.end();
}
