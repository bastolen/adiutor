/**
 * @file Tests for environment variable validation.
 */
import { describe, expect, it } from 'vitest';

import { parseEnv } from './env-schema';

/** The minimum set of valid variables. */
const validEnv = {
  DATABASE_URL: 'postgresql://adiutor:adiutor@localhost:5432/adiutor',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('accepts the required variables and fills in defaults', () => {
    const env = parseEnv(validEnv);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.EMAIL_FROM).toBe('Adiutor <no-reply@adiutor.dev>');
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.CLIENT_IP_HEADERS).toEqual(['x-forwarded-for']);
    expect(env.TRUSTED_PROXIES).toEqual([]);
  });

  it('treats empty optional variables as unset', () => {
    const env = parseEnv({ ...validEnv, GITHUB_CLIENT_ID: '', SMTP_URL: '', EMAIL_FROM: '' });
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.EMAIL_FROM).toBe('Adiutor <no-reply@adiutor.dev>');
  });

  it('rejects a missing database URL', () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a secret shorter than 32 characters', () => {
    expect(() => parseEnv({ ...validEnv, BETTER_AUTH_SECRET: 'too-short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('accepts versioned secrets and rejects malformed ones', () => {
    const secrets = `2:${'b'.repeat(32)},1:${'a'.repeat(32)}`;
    expect(parseEnv({ ...validEnv, BETTER_AUTH_SECRETS: secrets }).BETTER_AUTH_SECRETS).toBe(
      secrets,
    );
    expect(() => parseEnv({ ...validEnv, BETTER_AUTH_SECRETS: 'no-version' })).toThrow(
      /BETTER_AUTH_SECRETS/,
    );
  });

  it('reads the client IP headers and trusted proxies as lists', () => {
    const env = parseEnv({
      ...validEnv,
      CLIENT_IP_HEADERS: 'X-Real-IP, x-forwarded-for',
      TRUSTED_PROXIES: '10.0.0.5, 10.0.1.0/24,2001:db8::/32',
    });
    expect(env.CLIENT_IP_HEADERS).toEqual(['x-real-ip', 'x-forwarded-for']);
    expect(env.TRUSTED_PROXIES).toEqual(['10.0.0.5', '10.0.1.0/24', '2001:db8::/32']);
    expect(() => parseEnv({ ...validEnv, TRUSTED_PROXIES: 'proxy.adiutor.dev' })).toThrow(
      /TRUSTED_PROXIES/,
    );
  });

  it('reads the networks webhooks may reach as a list, empty when unset', () => {
    expect(parseEnv(validEnv).WEBHOOK_ALLOWED_NETWORKS).toEqual([]);
    expect(
      parseEnv({ ...validEnv, WEBHOOK_ALLOWED_NETWORKS: '10.20.0.0/16, 127.0.0.1,fd00::/8' })
        .WEBHOOK_ALLOWED_NETWORKS,
    ).toEqual(['10.20.0.0/16', '127.0.0.1', 'fd00::/8']);
    expect(() =>
      parseEnv({ ...validEnv, WEBHOOK_ALLOWED_NETWORKS: 'intranet.adiutor.dev' }),
    ).toThrow(/WEBHOOK_ALLOWED_NETWORKS/);
  });

  it('reads the end-to-end tests’ port as a number, when a checkout sets one', () => {
    expect(parseEnv({ ...validEnv, E2E_PORT: '3105' }).E2E_PORT).toBe(3105);
    expect(parseEnv({ ...validEnv, E2E_PORT: '' }).E2E_PORT).toBeUndefined();
    expect(parseEnv(validEnv).E2E_PORT).toBeUndefined();
  });

  it('rejects an end-to-end port that no server may be given', () => {
    ['80', '70000', '3100.5', 'three thousand'].forEach((E2E_PORT) => {
      expect(() => parseEnv({ ...validEnv, E2E_PORT }), E2E_PORT).toThrow(/at E2E_PORT/);
    });
  });

  it('refuses an email outbox in production, except for the end-to-end tests', () => {
    const production = { ...validEnv, NODE_ENV: 'production', EMAIL_OUTBOX_DIR: '/tmp/outbox' };
    expect(() => parseEnv(production)).toThrow(/EMAIL_OUTBOX_DIR/);
    expect(parseEnv({ ...production, E2E_TESTS: '1' }).EMAIL_OUTBOX_DIR).toBe('/tmp/outbox');
    expect(parseEnv({ ...validEnv, EMAIL_OUTBOX_DIR: '/tmp/outbox' }).EMAIL_OUTBOX_DIR).toBe(
      '/tmp/outbox',
    );
  });

  describe('attachment storage', () => {
    /** A bucket with everything it needs. */
    const bucket = {
      ATTACHMENTS_STORAGE: 's3',
      ATTACHMENTS_S3_ENDPOINT: 'https://files.adiutor.dev',
      ATTACHMENTS_S3_BUCKET: 'adiutor',
      ATTACHMENTS_S3_ACCESS_KEY_ID: 'key-id',
      ATTACHMENTS_S3_SECRET_ACCESS_KEY: 'key-secret',
    };

    it('leaves storage to Settings when nothing chooses one', () => {
      const env = parseEnv({ ...validEnv, ATTACHMENTS_STORAGE: '', ATTACHMENTS_MAX_FILE_MB: '' });
      expect(env.ATTACHMENTS_STORAGE).toBeUndefined();
      expect(env.ATTACHMENTS_MAX_FILE_MB).toBeUndefined();
    });

    it('accepts a folder or a bucket with what it needs, and off', () => {
      expect(
        parseEnv({ ...validEnv, ATTACHMENTS_STORAGE: 'local', ATTACHMENTS_DIR: '/data/files' })
          .ATTACHMENTS_DIR,
      ).toBe('/data/files');
      expect(parseEnv({ ...validEnv, ...bucket }).ATTACHMENTS_S3_BUCKET).toBe('adiutor');
      // A name that isn't a bucket's would become part of another host name.
      expect(() =>
        parseEnv({ ...validEnv, ...bucket, ATTACHMENTS_S3_BUCKET: 'evil.adiutor.test/x' }),
      ).toThrow(/ATTACHMENTS_S3_BUCKET/);
      expect(parseEnv({ ...validEnv, ATTACHMENTS_STORAGE: 'off' }).ATTACHMENTS_STORAGE).toBe('off');
    });

    it('names everything a driver is missing', () => {
      expect(() => parseEnv({ ...validEnv, ATTACHMENTS_STORAGE: 'local' })).toThrow(
        /Required when ATTACHMENTS_STORAGE is local\.\n\s+→ at ATTACHMENTS_DIR/,
      );
      expect(() =>
        parseEnv({
          ...validEnv,
          ...bucket,
          ATTACHMENTS_S3_BUCKET: '',
          ATTACHMENTS_S3_SECRET_ACCESS_KEY: '',
        }),
      ).toThrow(/ATTACHMENTS_S3_BUCKET[\s\S]*ATTACHMENTS_S3_SECRET_ACCESS_KEY/);
      expect(() => parseEnv({ ...validEnv, ATTACHMENTS_STORAGE: 'ftp' })).toThrow(
        /ATTACHMENTS_STORAGE/,
      );
    });

    it('refuses a relative folder, and a folder on Vercel', () => {
      expect(() =>
        parseEnv({ ...validEnv, ATTACHMENTS_STORAGE: 'local', ATTACHMENTS_DIR: 'files' }),
      ).toThrow(/absolute path/);
      expect(() =>
        parseEnv({
          ...validEnv,
          VERCEL: '1',
          ATTACHMENTS_STORAGE: 'local',
          ATTACHMENTS_DIR: '/data/files',
        }),
      ).toThrow(/Vercel's disk doesn't keep files/);
    });

    it('takes an SFTP server with a password or a key, and its host key fingerprint', () => {
      const server = {
        ...validEnv,
        ATTACHMENTS_STORAGE: 'sftp',
        ATTACHMENTS_SFTP_HOST: 'files.adiutor.dev',
        ATTACHMENTS_SFTP_USERNAME: 'adiutor',
        ATTACHMENTS_SFTP_HOST_KEY: 'SHA256:8Tn3u1YtizSXC8tJi132t6S2H2YZA9+pMADqWxgBdls',
        ATTACHMENTS_SFTP_DIR: '/srv/adiutor',
      };
      const withPassword = { ...server, ATTACHMENTS_SFTP_PASSWORD: 'secret' };
      expect(
        parseEnv({ ...withPassword, ATTACHMENTS_SFTP_PORT: '2222' }).ATTACHMENTS_SFTP_PORT,
      ).toBe(2222);
      expect(() => parseEnv(server)).toThrow(
        /Required, or ATTACHMENTS_SFTP_PRIVATE_KEY, when ATTACHMENTS_STORAGE is sftp/,
      );
      expect(() => parseEnv({ ...withPassword, ATTACHMENTS_SFTP_HOST_KEY: 'ab:cd' })).toThrow(
        /SHA256: fingerprint/,
      );
      expect(() => parseEnv({ ...server, ATTACHMENTS_SFTP_PRIVATE_KEY: 'not base64!' })).toThrow(
        /ATTACHMENTS_SFTP_PRIVATE_KEY/,
      );
      expect(() => parseEnv({ ...withPassword, ATTACHMENTS_SFTP_DIR: 'adiutor' })).toThrow(
        /absolute path[\s\S]*ATTACHMENTS_SFTP_DIR/,
      );
    });

    it('takes a limit from 1 to 50 megabytes, and at most 4 on Vercel', () => {
      expect(parseEnv({ ...validEnv, ATTACHMENTS_MAX_FILE_MB: '25' }).ATTACHMENTS_MAX_FILE_MB).toBe(
        25,
      );
      expect(() => parseEnv({ ...validEnv, ATTACHMENTS_MAX_FILE_MB: '51' })).toThrow(
        /ATTACHMENTS_MAX_FILE_MB/,
      );
      expect(() => parseEnv({ ...validEnv, ATTACHMENTS_MAX_FILE_MB: '0' })).toThrow(
        /ATTACHMENTS_MAX_FILE_MB/,
      );
      expect(() => parseEnv({ ...validEnv, VERCEL: '1', ATTACHMENTS_MAX_FILE_MB: '5' })).toThrow(
        /At most 4 on Vercel/,
      );
    });

    it('refuses a bucket over plain http in production, except on this computer', () => {
      const production = {
        ...validEnv,
        BETTER_AUTH_URL: 'https://adiutor.dev',
        NODE_ENV: 'production',
        ...bucket,
      };
      expect(() =>
        parseEnv({ ...production, ATTACHMENTS_S3_ENDPOINT: 'http://files.adiutor.dev' }),
      ).toThrow(/https:\/\/ address in production/);
      expect(
        parseEnv({ ...production, ATTACHMENTS_S3_ENDPOINT: 'http://localhost:8333' })
          .ATTACHMENTS_S3_ENDPOINT,
      ).toBe('http://localhost:8333');
      expect(
        parseEnv({ ...validEnv, ...bucket, ATTACHMENTS_S3_ENDPOINT: 'http://files.adiutor.dev' })
          .ATTACHMENTS_S3_ENDPOINT,
      ).toBe('http://files.adiutor.dev');
    });
  });

  describe('in production', () => {
    /** A production server's settings. */
    const production = {
      ...validEnv,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://adiutor.dev',
      SMTP_URL: 'smtps://adiutor:secret@smtp.adiutor.dev:465',
    };

    it('accepts https and SMTP over TLS', () => {
      expect(parseEnv(production).BETTER_AUTH_URL).toBe('https://adiutor.dev');
      expect(
        parseEnv({
          ...production,
          SMTP_URL: 'smtp://adiutor:secret@smtp.adiutor.dev:587?requireTLS=true',
        }).SMTP_URL,
      ).toBe('smtp://adiutor:secret@smtp.adiutor.dev:587?requireTLS=true');
      expect(parseEnv({ ...production, SMTP_URL: '' }).SMTP_URL).toBeUndefined();
    });

    it('refuses an http address on another computer, saying what to use', () => {
      ['http://adiutor.dev', 'http://192.168.1.10:3000', 'ftp://adiutor.dev'].forEach(
        (BETTER_AUTH_URL) => {
          expect(() => parseEnv({ ...production, BETTER_AUTH_URL }), BETTER_AUTH_URL).toThrow(
            /Use an https:\/\/ address in production.*\n.*at BETTER_AUTH_URL/,
          );
        },
      );
    });

    it('refuses plaintext SMTP to another computer, saying what to use', () => {
      [
        'smtp://adiutor:secret@smtp.adiutor.dev:587',
        'smtp://smtp.adiutor.dev:25?requireTLS=false',
        'smtp://smtp.adiutor.dev:587?secure=true',
        'smtp://smtp.adiutor.dev:587?ignoreTLS=true',
        'direct://smtp.adiutor.dev',
      ].forEach((SMTP_URL) => {
        expect(() => parseEnv({ ...production, SMTP_URL }), SMTP_URL).toThrow(
          /Use TLS in production: smtps:\/\/.*\?requireTLS=true.*\n.*at SMTP_URL/,
        );
      });
    });

    it("accepts the end-to-end tests' production build on localhost", () => {
      const e2e = parseEnv({
        ...validEnv,
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'http://localhost:3100',
        EMAIL_OUTBOX_DIR: '/tmp/outbox',
        E2E_TESTS: '1',
        // A developer's .env with Mailpit, which the tests' build reads too.
        SMTP_URL: 'smtp://localhost:1025',
      });
      expect(e2e.BETTER_AUTH_URL).toBe('http://localhost:3100');
      ['http://127.0.0.1:3100', 'http://[::1]:3100', 'http://adiutor.localhost:3100'].forEach(
        (BETTER_AUTH_URL) => {
          expect(parseEnv({ ...production, BETTER_AUTH_URL }).BETTER_AUTH_URL).toBe(
            BETTER_AUTH_URL,
          );
        },
      );
      ['smtp://127.0.0.1:1025', 'smtp://[::1]:1025', 'smtp://mailpit.localhost:1025'].forEach(
        (SMTP_URL) => {
          expect(parseEnv({ ...production, SMTP_URL }).SMTP_URL).toBe(SMTP_URL);
        },
      );
    });

    it("doesn't apply in development or without NODE_ENV", () => {
      const insecure = {
        ...validEnv,
        BETTER_AUTH_URL: 'http://adiutor.dev',
        SMTP_URL: 'smtp://smtp.adiutor.dev:587',
      };
      expect(parseEnv(insecure).BETTER_AUTH_URL).toBe('http://adiutor.dev');
      expect(parseEnv({ ...insecure, NODE_ENV: 'development' }).SMTP_URL).toBe(
        'smtp://smtp.adiutor.dev:587',
      );
      expect(parseEnv({ ...insecure, NODE_ENV: 'test' }).SMTP_URL).toBe(
        'smtp://smtp.adiutor.dev:587',
      );
    });
  });
});
