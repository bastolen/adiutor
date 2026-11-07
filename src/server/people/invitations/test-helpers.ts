/**
 * @file The test context shared by the integration tests of email invitations.
 */
import { setupTestContext } from '../../../../tests/integration/helpers';

/**
 * The test database context these tests share. Each test file imports this
 * module afresh (Vitest isolates test files), so each gets its own context
 * and hooks, as when it called `setupTestContext()` itself.
 */
export const { ctx, db, sent } = setupTestContext();
