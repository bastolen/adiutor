/**
 * @file Tests for the checks of the development seed: it only runs against a
 * local database of an app on this computer, outside production, going by
 * the database host the driver connects to.
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

  it('goes by the host the driver connects to, which a host parameter names', () => {
    // `pg` connects to the `host` parameter, whatever host the URL starts with.
    [
      'postgresql://adiutor:adiutor@localhost:5432/adiutor?host=db.adiutor.dev',
      // A socket's folder: how a Cloud SQL database, which is elsewhere, is usually written.
      'postgresql://adiutor:adiutor@localhost:5432/adiutor?host=/cloudsql/adiutor:europe-west4:main',
      'postgresql://adiutor:adiutor@localhost/adiutor?host=%2Fcloudsql%2Fadiutor',
      'postgresql://adiutor:adiutor@%2Fcloudsql%2Fadiutor/adiutor',
      'socket://adiutor:adiutor@/cloudsql/adiutor?db=adiutor',
      // A folder or a list that ends in a local name is still not this computer.
      'postgresql://adiutor:adiutor@localhost/adiutor?host=/var/run/db.localhost',
      'postgresql://adiutor:adiutor@localhost/adiutor?host=db.adiutor.dev,localhost',
      'postgresql://adiutor:adiutor@localhost/adiutor?host=localhost,db.adiutor.dev',
      // No host at all: the driver would take one from its environment.
      'postgresql:///adiutor',
    ].forEach((databaseUrl) => {
      expect(devSeedRefusal({ ...local, databaseUrl }), databaseUrl).toBe(
        'Refusing to seed a database on another computer: this deletes all its data.',
      );
    });
  });

  it('lets a local host parameter through, and still refuses the test database then', () => {
    [
      'postgresql://adiutor:adiutor@localhost:5432/adiutor?host=localhost',
      'postgresql://adiutor:adiutor@db.adiutor.dev/adiutor?host=127.0.0.1&port=5432',
      'postgresql://adiutor:adiutor@[::1]:5432/adiutor',
      'postgresql://adiutor:adiutor@localhost:5432/adiutor?sslmode=disable',
    ].forEach((databaseUrl) => {
      expect(devSeedRefusal({ ...local, databaseUrl }), databaseUrl).toBeNull();
    });
    expect(
      devSeedRefusal({
        ...local,
        databaseUrl: 'postgresql://adiutor:adiutor@db.adiutor.dev/adiutor_test?host=localhost',
      }),
    ).toBe('Refusing to seed a test database; the tests manage it themselves.');
  });
});
