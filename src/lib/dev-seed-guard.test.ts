/**
 * @file Tests for the checks of the development seed: it only runs against a
 * local database of an app on this computer, outside production.
 */
import { describe, expect, it } from 'vitest';

import devSeedRefusal from './dev-seed-guard';

/** The settings of a local development set-up, from `.env.example`. */
const local = {
  nodeEnv: undefined,
  databaseUrl: 'postgresql://adiutor:adiutor@localhost:5432/adiutor',
  authUrl: 'http://localhost:3000',
};

describe('devSeedRefusal', () => {
  it('lets the seed run on a local development set-up', () => {
    expect(devSeedRefusal(local)).toBeNull();
    expect(devSeedRefusal({ ...local, nodeEnv: 'development' })).toBeNull();
    expect(
      devSeedRefusal({
        ...local,
        databaseUrl: 'postgresql://adiutor:adiutor@127.0.0.1:5432/adiutor',
        authUrl: 'http://adiutor.localhost:3000',
      }),
    ).toBeNull();
  });

  it('refuses production', () => {
    expect(devSeedRefusal({ ...local, nodeEnv: 'production' })).toBe(
      'Refusing to seed: NODE_ENV is production.',
    );
  });

  it("refuses a server's app address, even when its database listens on localhost", () => {
    ['https://adiutor.dev', 'http://adiutor.dev', 'https://localhost.adiutor.dev'].forEach(
      (authUrl) => {
        expect(devSeedRefusal({ ...local, authUrl }), authUrl).toMatch(
          /^Refusing to seed: BETTER_AUTH_URL is not on this computer.*http:\/\/localhost:3000\.$/,
        );
      },
    );
  });

  it('refuses a database on another computer, and the test database', () => {
    expect(
      devSeedRefusal({
        ...local,
        databaseUrl: 'postgresql://adiutor:adiutor@db.adiutor.dev:5432/adiutor',
      }),
    ).toBe('Refusing to seed a database on another computer: this deletes all its data.');
    expect(
      devSeedRefusal({
        ...local,
        databaseUrl: 'postgresql://adiutor:adiutor@localhost:5432/adiutor_test',
      }),
    ).toBe('Refusing to seed a test database; the tests manage it themselves.');
  });
});
