/**
 * @file Errors that services throw for expected problems, and their messages.
 *
 * Services stay language-free: a {@link ServiceError} carries a message key
 * from the `errors` or `validation` catalogue and the values it needs, never
 * text. Whatever shows the error translates it into the reader's language:
 * `runAction` for server actions, a page with {@link serviceErrorMessage},
 * scripts in English (US). See docs/i18n.md, "Errors from services".
 */
import type { MessageKeys, NestedKeyOf } from 'use-intl/core';
import type { ZodError } from 'zod';

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { type Messages, messagesFor } from '@/lib/i18n/messages';
import translator from '@/lib/i18n/translator';
import { idSchema, type ValidationMessageKey } from '@/lib/validation';

/**
 * Kinds of expected problems. `confirmation_required` is a change that needs
 * the actor's second step from the last 15 minutes first (e.g. giving a staff
 * role, see `assertConfirmedForGrant`); actions send the actor to confirm.
 */
export type ServiceErrorCode =
  'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'rate_limited' | 'confirmation_required';

/** A message of the `errors` catalogue, by its key within the namespace. */
type ErrorsKey = MessageKeys<Messages['errors'], NestedKeyOf<Messages['errors']>>;

/**
 * A message that explains an expected problem: a full key in the `errors`
 * catalogue (refusals of services, e.g. `errors.forbidden`) or the
 * `validation` catalogue (input that isn't valid, e.g. `validation.email`).
 * TypeScript checks it against the English (US) catalogues.
 */
export type ErrorMessageKey = `errors.${ErrorsKey}` | ValidationMessageKey;

/** The values a message's ICU arguments take, e.g. `{ minutes: 3 }`. */
export type ErrorMessageValues = Record<string, string | number>;

/**
 * An expected problem, such as a missing permission or invalid input. It
 * carries what to say, not the text: `message` holds the key (for logs, as it
 * never holds personal data), and {@link serviceErrorMessage} translates it.
 */
export class ServiceError extends Error {
  /** What kind of problem this is. */
  readonly code: ServiceErrorCode;

  /** The message that explains it to the user, e.g. `errors.forbidden`. */
  readonly key: ErrorMessageKey;

  /** The values of the message's arguments, if it has any. */
  readonly values: ErrorMessageValues | undefined;

  /**
   * Creates a service error.
   *
   * @param code - What kind of problem this is.
   * @param key - The message that explains it, a whole sentence (or two).
   * @param values - The values of the message's arguments, e.g. `{ company: 'Adiutor' }`.
   */
  constructor(code: ServiceErrorCode, key: ErrorMessageKey, values?: ErrorMessageValues) {
    super(key);
    this.name = 'ServiceError';
    this.code = code;
    this.key = key;
    this.values = values;
  }
}

/**
 * Checks whether a string is the key of a message in the `errors` or
 * `validation` catalogue, e.g. a zod issue's message.
 *
 * @param value - The string to check.
 * @returns Whether it names a message.
 */
export function isErrorMessageKey(value: string): value is ErrorMessageKey {
  const [namespace, ...path] = value.split('.');
  if (namespace !== 'errors' && namespace !== 'validation') {
    return false;
  }
  const found = path.reduce<unknown>(
    (group, part) =>
      typeof group === 'object' && group !== null && Object.hasOwn(group, part)
        ? (group as Record<string, unknown>)[part]
        : undefined,
    messagesFor(DEFAULT_LOCALE)[namespace],
  );
  return typeof found === 'string';
}

/**
 * Translates an error message.
 *
 * @param locale - The reader's language.
 * @param key - The message.
 * @param values - The values of its arguments, if any.
 * @returns The message in that language.
 */
export function errorMessage(
  locale: Locale,
  key: ErrorMessageKey,
  values?: ErrorMessageValues,
): string {
  if (key.startsWith('validation.')) {
    const t = translator(locale, 'validation');
    return t(key.slice('validation.'.length) as Parameters<typeof t>[0], values);
  }
  const t = translator(locale, 'errors');
  return t(key.slice('errors.'.length) as ErrorsKey, values);
}

/**
 * Translates a service error's message, for the reader of the page or form
 * that shows it.
 *
 * @param error - The error.
 * @param locale - The reader's language.
 * @returns The message in that language.
 */
export function serviceErrorMessage(error: ServiceError, locale: Locale): string {
  return errorMessage(locale, error.key, error.values);
}

/**
 * The values a zod issue gives its message: the limit of a length check
 * (`minimum`, `maximum`), or the `params` of a refinement.
 *
 * @param issue - The issue.
 * @returns The values.
 */
function issueValues(issue: ZodError['issues'][number]): ErrorMessageValues {
  const values: ErrorMessageValues = {};
  if (issue.code === 'custom') {
    Object.entries(issue.params ?? {}).forEach(([name, value]: [string, unknown]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        values[name] = value;
      }
    });
  }
  if (issue.code === 'too_small') {
    values.minimum = Number(issue.minimum);
  }
  if (issue.code === 'too_big') {
    values.maximum = Number(issue.maximum);
  }
  return values;
}

/**
 * Translates the first problem of invalid input. The schemas in
 * `src/lib/validation.ts` give every issue a message key; an issue without one
 * (zod's own wording, e.g. for a field that isn't a string) gets "Check your
 * input." instead.
 *
 * @param error - What zod threw.
 * @param locale - The reader's language.
 * @returns The message in that language.
 */
export function validationErrorMessage(error: ZodError, locale: Locale): string {
  const [issue] = error.issues;
  if (!issue || !isErrorMessageKey(issue.message)) {
    return errorMessage(locale, 'validation.checkInput');
  }
  return errorMessage(locale, issue.message, issueValues(issue));
}

/**
 * The error for something that doesn't exist or that the user may not see.
 * Both look the same, so the error doesn't reveal what exists.
 *
 * @returns The error.
 */
export function notFoundError(): ServiceError {
  return new ServiceError('not_found', 'errors.notFound');
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
  return new ServiceError('forbidden', 'errors.forbidden');
}

/** What a user is told when their change crossed another one at the same moment. */
export const CONCURRENT_CHANGE_MESSAGE = 'errors.concurrentChange' satisfies ErrorMessageKey;

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
  return new ServiceError('invalid', 'errors.companyDeactivated');
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
