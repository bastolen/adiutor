/**
 * @file Tests for the storage rules: how the environment chooses a storage,
 * what makes one unfit for where it runs, and the size limit's ceiling.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_S3_REGION,
  maxFileMbCeiling,
  type S3StorageConfig,
  storageFromEnvironment,
  storageProblems,
} from './storage';

/** A bucket's settings. */
const bucket: S3StorageConfig = {
  driver: 's3',
  endpoint: 'https://files.adiutor.dev',
  region: 'auto',
  bucket: 'adiutor',
  accessKeyId: 'key-id',
  secretAccessKey: 'key-secret',
  forcePathStyle: false,
};

/** A development server that isn't on Vercel. */
const development = { production: false, vercel: false };

describe('storageFromEnvironment', () => {
  it('leaves storage to Settings without a driver, and says off when it is', () => {
    expect(storageFromEnvironment({})).toEqual({ state: 'unset' });
    expect(storageFromEnvironment({ ATTACHMENTS_STORAGE: 'off' })).toEqual({ state: 'off' });
  });

  it('reads a folder', () => {
    expect(
      storageFromEnvironment({ ATTACHMENTS_STORAGE: 'local', ATTACHMENTS_DIR: '/data/files' }),
    ).toEqual({ state: 'set', config: { driver: 'local', dir: '/data/files' } });
  });

  it('reads a bucket, with the default region and path style off unless said', () => {
    const environment = {
      ATTACHMENTS_STORAGE: 's3',
      ATTACHMENTS_S3_ENDPOINT: 'https://files.adiutor.dev',
      ATTACHMENTS_S3_BUCKET: 'adiutor',
      ATTACHMENTS_S3_ACCESS_KEY_ID: 'key-id',
      ATTACHMENTS_S3_SECRET_ACCESS_KEY: 'key-secret',
    } as const;
    expect(storageFromEnvironment(environment)).toEqual({
      state: 'set',
      config: { ...bucket, region: DEFAULT_S3_REGION },
    });
    expect(
      storageFromEnvironment({
        ...environment,
        ATTACHMENTS_S3_REGION: 'auto',
        ATTACHMENTS_S3_FORCE_PATH_STYLE: 'true',
      }),
    ).toEqual({ state: 'set', config: { ...bucket, forcePathStyle: true } });
  });

  it('names what a driver is missing', () => {
    expect(storageFromEnvironment({ ATTACHMENTS_STORAGE: 'local' })).toEqual({
      state: 'incomplete',
      missing: ['ATTACHMENTS_DIR'],
    });
    expect(
      storageFromEnvironment({ ATTACHMENTS_STORAGE: 's3', ATTACHMENTS_S3_BUCKET: 'adiutor' }),
    ).toEqual({
      state: 'incomplete',
      missing: [
        'ATTACHMENTS_S3_ENDPOINT',
        'ATTACHMENTS_S3_ACCESS_KEY_ID',
        'ATTACHMENTS_S3_SECRET_ACCESS_KEY',
      ],
    });
  });
});

describe('storageProblems', () => {
  it('accepts an absolute folder off Vercel, and a bucket', () => {
    expect(storageProblems({ driver: 'local', dir: '/data/files' }, development)).toEqual([]);
    expect(storageProblems({ driver: 'local', dir: 'C:\\files' }, development)).toEqual([]);
    expect(storageProblems(bucket, { production: true, vercel: true })).toEqual([]);
  });

  it('refuses a relative folder, and any folder on Vercel', () => {
    expect(storageProblems({ driver: 'local', dir: 'files' }, development)).toEqual([
      'relative_folder',
    ]);
    expect(
      storageProblems({ driver: 'local', dir: '/data/files' }, { production: true, vercel: true }),
    ).toEqual(['local_on_vercel']);
  });

  it('refuses a bucket over plain http in production, except on this computer', () => {
    const plain = { ...bucket, endpoint: 'http://files.adiutor.dev' };
    expect(storageProblems(plain, { production: true, vercel: false })).toEqual([
      'insecure_endpoint',
    ]);
    expect(
      storageProblems(
        { ...bucket, endpoint: 'http://localhost:8333' },
        { production: true, vercel: false },
      ),
    ).toEqual([]);
    expect(storageProblems(plain, development)).toEqual([]);
  });
});

describe('maxFileMbCeiling', () => {
  it('allows 50 megabytes, or 4 on Vercel', () => {
    expect(maxFileMbCeiling(false)).toBe(50);
    expect(maxFileMbCeiling(true)).toBe(4);
  });
});
