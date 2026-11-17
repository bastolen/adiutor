/**
 * @file Tests for reading a connection URL as the driver does: the host, port
 * and database it connects to, which query parameters can change.
 */
import { describe, expect, it } from 'vitest';

import databaseAddress from './database-address';

describe('databaseAddress', () => {
  it('reads the host, port and database of a plain URL', () => {
    expect(databaseAddress('postgresql://adiutor:adiutor@localhost:5433/adiutor')).toEqual({
      host: 'localhost',
      port: '5433',
      database: 'adiutor',
    });
  });

  it('gives PostgreSQL’s port when the URL names none, and IPv6 without brackets', () => {
    expect(databaseAddress('postgresql://adiutor:adiutor@[::1]/adiutor')).toEqual({
      host: '::1',
      port: '5432',
      database: 'adiutor',
    });
  });

  it('lets a host or port parameter win over the URL’s own, as the driver does', () => {
    expect(
      databaseAddress(
        'postgresql://adiutor:adiutor@localhost:5432/adiutor?host=db.adiutor.dev&port=6543',
      ),
    ).toEqual({ host: 'db.adiutor.dev', port: '6543', database: 'adiutor' });
    // A socket's folder, written as a parameter or as the encoded host.
    expect(
      databaseAddress('postgresql://adiutor:adiutor@localhost/adiutor?host=/cloudsql/adiutor').host,
    ).toBe('/cloudsql/adiutor');
    expect(databaseAddress('postgresql://adiutor:adiutor@%2Fcloudsql%2Fadiutor/adiutor').host).toBe(
      '/cloudsql/adiutor',
    );
  });

  it('gives an empty host or database when the URL names none', () => {
    expect(databaseAddress('postgresql:///adiutor')).toEqual({
      host: '',
      port: '5432',
      database: 'adiutor',
    });
    expect(databaseAddress('postgresql://adiutor:adiutor@localhost:5432').database).toBe('');
  });
});
