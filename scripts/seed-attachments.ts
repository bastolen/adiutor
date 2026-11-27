/**
 * @file Attaches the sample files to the sample requests in the local
 * development database as it is, without seeding it again
 * (`scripts/sample-attachments/`): for data seeded before the samples had
 * files, or a storage chosen after seeding. It stores them in the storage
 * attachments go to now (the server's environment, else the Attachments tab
 * of Settings) and changes no settings, so attaching stays as it was.
 *
 * Usage: `pnpm db:seed:attachments`. Safe to run again: files already there
 * are left alone, and those missing from the storage are stored again. It
 * refuses the databases the seed refuses (`src/lib/dev-seed-guard.ts`): only
 * a local development database, never a test database or production.
 */
import { db } from '../src/db';
import devSeedRefusal from '../src/lib/dev-seed-guard';
import { env } from '../src/lib/env';
import { activeStorage, type FileStorage, StorageError } from '../src/server/storage';
import runScript from './run-script';
import attachSampleFiles, {
  noStorageMessage,
  type SampleAttachmentsSummary,
  summaryLines,
} from './sample-attachments';

/**
 * Attaches the sample files, turning a storage that refuses them into a
 * message for the developer.
 *
 * @param storage - The storage files go to.
 * @returns What it did, or `null` when the storage refused (with the reason printed).
 */
async function attachOrExplain(storage: FileStorage): Promise<SampleAttachmentsSummary | null> {
  try {
    return await attachSampleFiles(db, storage);
  } catch (error) {
    if (!(error instanceof StorageError)) {
      throw error;
    }
    console.error(
      `The storage refused the sample files (${error.failure}). A folder that was deleted, or never set up, needs setting up again on the Attachments tab of Settings, or a new seed.`,
    );
    return null;
  }
}

/**
 * Attaches the sample files, after the same checks as the seed.
 *
 * @returns The process exit code: 1 when it may not run, there's no storage, the storage refuses,
 *   or no sample text was found.
 */
async function main(): Promise<number> {
  const refusal = devSeedRefusal({
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    authUrl: env.BETTER_AUTH_URL,
  });
  if (refusal) {
    console.error(refusal);
    return 1;
  }
  const storage = await activeStorage(db);
  if (!storage) {
    console.error(noStorageMessage(env));
    return 1;
  }
  const summary = await attachOrExplain(storage);
  if (!summary) {
    return 1;
  }
  for (const line of summaryLines(summary)) {
    console.info(line);
  }
  if (summary.added + summary.alreadyThere + summary.restored === 0) {
    console.error('None of the sample requests is there. Seed first: pnpm db:seed --yes.');
    return 1;
  }
  return 0;
}

runScript(main);
