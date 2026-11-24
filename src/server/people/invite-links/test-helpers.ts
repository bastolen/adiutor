/**
 * @file The fixtures and helpers shared by the integration tests of invite
 * links: the test database context, and, created again before each test, a
 * company (`testCompany`) with an Admin (`admin`), plus `newLinkToken` to
 * create a link.
 */
import { beforeEach } from 'vitest';

import { defined } from '@/lib/defined';

import {
  createCompany,
  memberActor,
  setupTestContext,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';
import { createInviteLink } from './manage';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself. Its hook, which
 * empties the database, is added first: the fixtures below come after it.
 */
export const { ctx, db, sent } = setupTestContext();

/** The company the tests create links for. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let testCompany: Awaited<ReturnType<typeof createCompany>>;
/** An Admin of {@link testCompany}, who creates the links. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let admin: Actor;

beforeEach(async () => {
  testCompany = await createCompany(db);
  admin = await memberActor(db, testCompany.id, 'admin');
});

/**
 * Creates a 7-day Client link for the company.
 *
 * @returns The token from the link.
 */
export async function newLinkToken(): Promise<string> {
  const { url } = await createInviteLink(ctx, admin, {
    companyId: testCompany.id,
    role: 'client',
    validDays: 7,
  });
  return defined(url.split('/join/')[1], 'the link token');
}
