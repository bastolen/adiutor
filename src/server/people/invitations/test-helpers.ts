/**
 * @file The fixtures shared by the integration tests of email invitations:
 * the test database context, and, created again before each test, the staff's
 * settings, a company (`testCompany`) with an Admin (`companyAdmin`) and a
 * Client (`member@adiutor.test`), a staff Manager (`staffManager`) and a user
 * with no role anywhere (`existing@adiutor.test`).
 */
import { beforeEach } from 'vitest';

import {
  createCompany,
  createStaffSettings,
  createUser,
  memberActor,
  setupTestContext,
  staffActor,
} from '../../../../tests/integration/helpers';
import type { Actor } from '../../actor';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself. Its hook, which
 * empties the database, is added first: the fixtures below come after it.
 */
export const { ctx, db, sent } = setupTestContext();

/** The company the tests invite people to. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let testCompany: Awaited<ReturnType<typeof createCompany>>;
/** An Admin of {@link testCompany}, who invites. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let companyAdmin: Actor;
/** A staff Manager, who may invite to any company and sees the real status. */
// eslint-disable-next-line import-x/no-mutable-exports -- set before each test; importers read the live binding
export let staffManager: Actor;

beforeEach(async () => {
  await createStaffSettings(db);
  testCompany = await createCompany(db);
  companyAdmin = await memberActor(db, testCompany.id, 'admin');
  staffManager = await staffActor(db, 'manager');
  await memberActor(db, testCompany.id, 'client', 'member@adiutor.test');
  await createUser(db, 'existing@adiutor.test');
});
