/**
 * @file drizzle-kit configuration: where the schema lives and where SQL
 * migrations are written.
 *
 * `pnpm db:generate` writes a migration for schema changes; `pnpm db:migrate`
 * applies pending migrations to `DATABASE_URL`.
 * @see https://orm.drizzle.team/docs/drizzle-config-file
 */
import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. in CI); the variables come from the environment.
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run drizzle-kit.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true,
});
