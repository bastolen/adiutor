/**
 * @file The test service context and its reset between tests, the switch for
 * GitHub sign-in, and contexts of a request's language or IP address, a mail
 * server that's down and a time a number of minutes ago. Attached files go
 * to a folder of the test file's own, removed after it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

import { createDatabase, type Database } from '@/db';
import type { Email } from '@/lib/email';
import type { Locale } from '@/lib/i18n/locales';
import { MFA_PROVIDERS } from '@/lib/sign-in/oauth-providers';
import { availableProviders, configuredProviders } from '@/lib/sign-in/providers';
import type { ServiceContext } from '@/server/context';
import { type FileStorage, storageFor } from '@/server/storage';

import emptyDatabase from '../../database/empty-database';

/** Test service context plus the emails it "sent". */
export interface TestContext {
  /** Service context on the test database. */
  ctx: ServiceContext;
  /** Database client for the test database. */
  db: Database;
  /** Emails sent during the current test. */
  sent: Email[];
  /** The storage the context's files go to: a folder of the test file's own on local disk. */
  storage: FileStorage;
}

/**
 * Creates a service context on the test database for a test file. Empties
 * the database and the captured emails before each test, turns GitHub
 * sign-in back on (see {@link turnOffGitHubSignIn}), and closes the
 * connection after the file.
 *
 * @returns The context; `sent` is cleared before each test.
 */
export function setupTestContext(): TestContext {
  const db = createDatabase(inject('databaseUrl'));
  const sent: Email[] = [];
  const folder = mkdtempSync(join(tmpdir(), 'adiutor-files-'));
  const storage = storageFor({ driver: 'local', dir: folder });
  const ctx: ServiceContext = {
    db,
    baseUrl: 'https://adiutor.test',
    /**
     * Captures an email instead of sending it.
     *
     * @param email - The email.
     */
    sendEmail: async (email) => {
      sent.push(email);
    },
    /**
     * The test file's own folder.
     *
     * @returns Its storage.
     */
    storage: async () => storage,
  };

  // Set up on purpose, as a staff Admin's test before saving would.
  beforeAll(async () => {
    await storage.setUp();
  });

  beforeEach(async () => {
    sent.length = 0;
    // Every provider that can prove MFA counts as configured again (see `turnOffGitHubSignIn`).
    availableProviders.splice(
      0,
      availableProviders.length,
      ...MFA_PROVIDERS.filter((provider) => configuredProviders[provider]),
    );
    await emptyDatabase(db);
  });

  afterAll(async () => {
    await db.$client.end();
    rmSync(folder, { recursive: true, force: true });
  });

  return { ctx, db, sent, storage };
}

/**
 * Makes the rest of the current test run as if GitHub sign-in weren't
 * configured on this server (the integration tests configure every provider
 * that can prove MFA), so the MFA rules don't count its accounts' two-factor
 * authentication anywhere: as MFA, as a second step or as something to keep.
 * It changes `availableProviders`, which every service passes to the rules;
 * {@link setupTestContext} turns it back on before the next test.
 */
export function turnOffGitHubSignIn(): void {
  const index = availableProviders.indexOf('github');
  if (index >= 0) {
    availableProviders.splice(index, 1);
  }
}

/**
 * The time a number of minutes ago.
 *
 * @param minutes - How many minutes.
 * @returns That time.
 */
export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/**
 * A service context whose request is in a language, as the app's is when
 * the browser asked for one (`requestLocale`).
 *
 * @param ctx - The test context.
 * @param locale - The request's language.
 * @returns The context, with `requestLocale`.
 */
export function inLanguage<C extends ServiceContext>(ctx: C, locale: Locale): C {
  return {
    ...ctx,
    /**
     * The request's language.
     *
     * @returns The locale.
     */
    requestLocale: async () => locale,
  };
}

/**
 * A service context whose request comes from an IP address, as the app's
 * does (`requestInfoFromHeaders`).
 *
 * @param ctx - The test context.
 * @param ip - The client's address.
 * @returns The context, with `requestInfo`.
 */
export function fromIp<C extends ServiceContext>(ctx: C, ip: string): C {
  return {
    ...ctx,
    /**
     * The request's client.
     *
     * @returns The IP address, without a browser.
     */
    requestInfo: async () => ({ ip, userAgent: null }),
  };
}

/**
 * The context with its mail server down: every email it sends fails.
 *
 * @param ctx - The service context.
 * @returns The same context, refusing every email.
 */
export function mailDown(ctx: ServiceContext): ServiceContext {
  return {
    ...ctx,
    /** Refuses the email, as a mail server that's down would. */
    sendEmail: async () => {
      throw new Error('Adiutor Tests: the mail server is down');
    },
  };
}
