/**
 * @file Setup for every integration test file (`setupFiles` of the
 * `integration` project in `vitest.config.mts`): swaps the app's database
 * module (`@/db`) for one whose client uses the test database, so code that
 * imports the client directly (the Better Auth hooks, the guards,
 * `auth.handler` flows) never reads or writes the development database, and
 * closes that client after the file's tests.
 */
import { afterAll, inject, vi } from 'vitest';

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, db: actual.createDatabase(inject('databaseUrl')) };
});

afterAll(async () => {
  const app = await import('@/db');
  await app.db.$client.end();
});
