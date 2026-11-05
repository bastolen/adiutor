/**
 * @file Tests for which database the tests use: only one whose name ends in
 * `_test` that isn't the development database, since the tests empty it.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from './database-url';

/** The development database, as in `.env.example`. */
const DEVELOPMENT = 'postgresql://adiutor:dev-secret@localhost:5432/adiutor';

describe('resolveTestDatabaseUrl', () => {
  it('derives adiutor_test on the development database’s server', () => {
    expect(resolveTestDatabaseUrl({ explicit: undefined, base: DEVELOPMENT })).toBe(
      'postgresql://adiutor:dev-secret@localhost:5432/adiutor_test',
    );
  });

  it.each([
    ['another name on the same server', 'postgresql://adiutor:dev-secret@localhost:5432/ci_test'],
    [
      'the same name on another port',
      'postgresql://adiutor:dev-secret@localhost:5433/adiutor_test',
    ],
    ['another server', 'postgresql://tester:test-secret@db.adiutor.test/adiutor_test'],
  ])('accepts an explicit test database: %s', (_case, explicit) => {
    expect(resolveTestDatabaseUrl({ explicit, base: DEVELOPMENT })).toBe(explicit);
  });

  it('accepts an explicit test database without a development one', () => {
    const explicit = 'postgresql://adiutor:adiutor@localhost:5432/adiutor_test';
    expect(resolveTestDatabaseUrl({ explicit, base: undefined })).toBe(explicit);
  });

  it.each([
    ['the development database', { explicit: DEVELOPMENT, base: DEVELOPMENT }, /must end in _test/],
    [
      'a staging database',
      {
        explicit: 'postgresql://adiutor:staging-secret@staging.adiutor.dev/adiutor_staging',
        base: DEVELOPMENT,
      },
      /must end in _test.*"adiutor_staging"/,
    ],
    [
      'the development database when it is itself called adiutor_test',
      { explicit: undefined, base: 'postgresql://adiutor:dev-secret@localhost/adiutor_test' },
      /must not be the development database/,
    ],
    [
      'the same database spelled with and without the default port',
      {
        explicit: 'postgresql://adiutor:dev-secret@localhost/adiutor_test',
        base: 'postgresql://adiutor:dev-secret@localhost:5432/adiutor_test',
      },
      /must not be the development database/,
    ],
    ['nothing at all', { explicit: undefined, base: undefined }, /Set DATABASE_URL_TEST/],
  ])('refuses %s', (_case, settings, message) => {
    expect(() => resolveTestDatabaseUrl(settings)).toThrow(message);
  });

  it('never puts a password in the error', () => {
    const settings = {
      explicit: 'postgresql://adiutor:staging-secret@staging.adiutor.dev/adiutor_staging',
      base: 'postgresql://adiutor:dev-secret@localhost:5432/adiutor_test',
    };
    expect(() => resolveTestDatabaseUrl(settings)).toThrow(
      expect.objectContaining({ message: expect.not.stringMatching(/secret|adiutor@/) }),
    );
    expect(() => resolveTestDatabaseUrl({ explicit: undefined, base: settings.base })).toThrow(
      expect.objectContaining({ message: expect.not.stringMatching(/secret/) }),
    );
  });
});
