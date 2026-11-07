/**
 * @file Errors that services throw for expected problems, with messages that
 * are safe to show to the user.
 */
import { idSchema } from '@/lib/validation';

/**
 * Kinds of expected problems. `confirmation_required` is a change that needs
 * the actor's second step from the last 15 minutes first (e.g. giving a staff
 * role, see `assertConfirmedForGrant`); actions send the actor to confirm.
 */
export type ServiceErrorCode =
  'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'rate_limited' | 'confirmation_required';

/**
 * An expected problem, such as a missing permission or invalid input. The
 * message is shown to the user as is.
 */
export class ServiceError extends Error {
  /** What kind of problem this is. */
  readonly code: ServiceErrorCode;

  /**
   * Creates a service error.
   *
   * @param code - What kind of problem this is.
   * @param message - User-facing explanation.
   */
  constructor(code: ServiceErrorCode, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

/**
 * The error for something that doesn't exist or that the user may not see.
 * Both look the same, so the error doesn't reveal what exists.
 *
 * @returns The error.
 */
export function notFoundError(): ServiceError {
  return new ServiceError('not_found', "This page doesn't exist or you don't have access to it.");
}

/**
 * Reads an ID from input (a form or the URL). Anything that isn't an ID gets
 * the same answer as an ID of something missing.
 *
 * @param value - The ID as given.
 * @returns The ID.
 * @throws {ServiceError} `not_found` when it isn't a valid ID.
 */
export function parseId(value: string): string {
  const id = idSchema.safeParse(value);
  if (!id.success) {
    throw notFoundError();
  }
  return id.data;
}

/**
 * The error for an action the user isn't allowed to take.
 *
 * @returns The error.
 */
export function forbiddenError(): ServiceError {
  return new ServiceError('forbidden', "You don't have permission to do that.");
}

/** What a user is told when their change crossed another one at the same moment. */
export const CONCURRENT_CHANGE_MESSAGE = 'Someone changed this at the same moment. Try again.';

/**
 * The error for a change that crossed another one at the same moment, and
 * that the user can simply try again (e.g. a database deadlock, or locks
 * that turned out not to cover what changed meanwhile).
 *
 * @returns The error (`conflict`).
 */
export function concurrentChangeError(): ServiceError {
  return new ServiceError('conflict', CONCURRENT_CHANGE_MESSAGE);
}

/**
 * The error for a change a deactivated company can't take (new people, role
 * changes, removals) until it's reactivated.
 *
 * @returns The error (`invalid`).
 */
export function companyDeactivatedError(): ServiceError {
  return new ServiceError('invalid', 'This company is deactivated. Reactivate it first.');
}

/**
 * Reads the `code` property of a value, if it has one.
 *
 * @param value - Any value, typically an error.
 * @returns The code, or `undefined`.
 */
function errorCode(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
}

/**
 * Checks whether a database error has a SQLSTATE code, on the error itself or
 * on its `cause` (Drizzle wraps the driver's error).
 *
 * @param error - The error thrown by a query.
 * @param code - The SQLSTATE code.
 * @returns Whether the error has that code.
 */
function hasSqlState(error: unknown, code: string): boolean {
  return (
    errorCode(error) === code ||
    (error instanceof Error && 'cause' in error && errorCode(error.cause) === code)
  );
}

/**
 * Checks whether a database error is a unique-constraint violation.
 *
 * @param error - The error thrown by a query.
 * @returns Whether a unique index rejected the write.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasSqlState(error, '23505');
}

/**
 * Checks whether a database error is a deadlock (SQLSTATE `40P01`): Postgres
 * ended this transaction because it and another one were each waiting for a
 * lock the other held. Transactions take their locks in one order (see "Lock
 * order" in `docs/security-measures.md`), so this is a backstop; `runAction`
 * asks the user to try again.
 *
 * @param error - The error thrown by a query or transaction.
 * @returns Whether Postgres ended the transaction to break a deadlock.
 */
export function isDeadlock(error: unknown): boolean {
  return hasSqlState(error, '40P01');
}
