/**
 * @file Schema and parser for the server-side environment variables.
 *
 * Kept separate from `env.ts`, which parses `process.env` as soon as it's
 * imported, so the parsing rules can be tested on their own. With
 * `NODE_ENV=production`, it also refuses settings only fit for development:
 * an email outbox, an `http://` app URL and SMTP without TLS (both allowed on
 * this computer, where the end-to-end tests run a production build). It
 * always checks a storage for attachments the environment chooses: what its
 * driver needs, and where it may run (`src/lib/storage.ts`).
 */
import { z } from 'zod';

import isLocalHostname, { isSecureOrLocalUrl } from './local-host';
import { parseAuthSecrets } from './sign-in/auth-secrets';
import {
  HOST_KEY_PATTERN,
  S3_BUCKET_PATTERN,
  MAX_FILE_MB,
  maxFileMbCeiling,
  STORAGE_DRIVERS,
  type StorageProblem,
  storageFromEnvironment,
  storageProblems,
} from './storage';

/** Where each storage problem points, and what it says, for an operator reading the error. */
const STORAGE_PROBLEM_ISSUES: Record<StorageProblem, { path: string[]; message: string }> = {
  local_on_vercel: {
    path: ['ATTACHMENTS_STORAGE'],
    message: "Vercel's disk doesn't keep files: use s3 (e.g. Cloudflare R2) instead.",
  },
  relative_folder: {
    path: ['ATTACHMENTS_DIR'],
    message: 'Use an absolute path, e.g. /data/attachments.',
  },
  insecure_endpoint: {
    path: ['ATTACHMENTS_S3_ENDPOINT'],
    message: 'Use an https:// address in production; http:// only works for localhost.',
  },
};

/**
 * Treats empty strings (e.g. `GITHUB_CLIENT_ID=` in a `.env` file) as unset.
 *
 * @param value - The raw environment value.
 * @returns The value, or `undefined` when it is an empty string.
 */
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

/** An optional, non-empty string. */
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/**
 * Parses a URL the schema has already checked, for the production rules.
 *
 * @param value - The URL, if any.
 * @returns The parsed URL, or `null` without one (or when it doesn't parse,
 *   which its own field reports).
 */
function parsedUrl(value: string | undefined): URL | null {
  return value && URL.canParse(value) ? new URL(value) : null;
}

/**
 * Whether the app's public URL is fit for production: `https://`, or
 * `http://` on this computer (`isLocalHostname`), as the end-to-end tests run
 * a production build on `http://localhost`. Over plain `http://`, cookies
 * lose `Secure` and the `__Secure-` prefix, and passkeys and HSTS don't work.
 *
 * @param url - `BETTER_AUTH_URL`, parsed.
 * @returns Whether it may be used in production.
 */
function isProductionAppUrl(url: URL): boolean {
  return isSecureOrLocalUrl(url);
}

/**
 * Whether an SMTP URL is fit for production: encrypted from the start
 * (`smtps://`), with STARTTLS required (`smtp://…?requireTLS=true`, which
 * nodemailer reads from the URL), or to a server on this computer (e.g.
 * Mailpit on `smtp://localhost:1025`). Without either, nodemailer only uses
 * STARTTLS when the server offers it, so someone on the network could strip
 * it and read the sign-in links in the emails.
 *
 * @param url - `SMTP_URL`, parsed.
 * @returns Whether it may be used in production.
 */
function isProductionSmtpUrl(url: URL): boolean {
  if (url.protocol === 'smtps:') {
    return true;
  }
  if (url.protocol === 'smtp:' && url.searchParams.get('requireTLS') === 'true') {
    return true;
  }
  return isLocalHostname(url.hostname);
}

/**
 * Schema for all server-side environment variables.
 */
const envSchema = z
  .object({
    /** PostgreSQL connection string for all of the app's data. */
    DATABASE_URL: z.url(),
    /**
     * Secret used by Better Auth to sign and encrypt, and by Adiutor to work
     * out its own secrets (`derivedSecret`); at least 32 characters. With
     * `BETTER_AUTH_SECRETS` set, it only decrypts older data.
     */
    BETTER_AUTH_SECRET: z.string().min(32),
    /**
     * Versioned secrets for rotation, newest first: `"2:new,1:old"`. Optional;
     * see `src/lib/sign-in/auth-secrets.ts` and "Rotating the auth secret" in
     * `docs/deploying.md`.
     */
    BETTER_AUTH_SECRETS: optionalString.superRefine((value, ctx) => {
      try {
        parseAuthSecrets(value);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
      }
    }),
    /**
     * Public base URL of the app, e.g. `http://localhost:3000`. In production
     * it must be `https://`, except on this computer ({@link isProductionAppUrl}).
     */
    BETTER_AUTH_URL: z.url(),
    /**
     * The secret the tick's endpoint (`/api/jobs`) asks for, as
     * `Authorization: Bearer <secret>`; at least 32 characters. Unset, the
     * endpoint is off (see "Background jobs" in `docs/deploying.md`), and so
     * are the jobs under `next dev`, whose tick calls the endpoint with it
     * (`src/server/jobs/dev-tick.ts`).
     */
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    /**
     * Vercel's Protection Bypass for Automation secret, which Vercel sets by
     * itself once it's generated (Settings → Deployment Protection). The
     * tick's endpoint sends it when it continues itself
     * (`x-vercel-protection-bypass`), so the call reaches a protected Preview
     * deployment. Unset elsewhere.
     */
    VERCEL_AUTOMATION_BYPASS_SECRET: optionalString,
    /**
     * GitHub OAuth app credentials. GitHub sign-in is enabled when both are
     * set, and only then does GitHub's 2FA count as MFA (see `src/lib/sign-in/providers.ts`).
     */
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    /** Google OAuth client credentials. Google sign-in is enabled when both are set. */
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    /**
     * SMTP connection URL for sending email, which wins over the mail server
     * saved on the Connections tab of Settings, e.g.
     * `smtps://user:password@smtp.adiutor.dev:465`, or
     * `smtp://user:password@smtp.adiutor.dev:587?requireTLS=true` for STARTTLS.
     * In production it must use TLS, except to a server on this computer
     * ({@link isProductionSmtpUrl}). Without it or a saved mail server, emails
     * are printed to the server console (development only).
     */
    SMTP_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    /**
     * Sender of outgoing email, e.g. `Adiutor <no-reply@adiutor.dev>`. When
     * set, it wins over the sender saved on the Connections tab of Settings; unset,
     * that one is used, else `DEFAULT_EMAIL_FROM` (`src/lib/smtp.ts`).
     */
    EMAIL_FROM: optionalString,
    /**
     * Folder to write outgoing emails to as JSON files instead of sending them.
     * For automated tests only; takes precedence over SMTP. Refused in
     * production unless `E2E_TESTS` is `1`, so a stray value can't silently
     * stop real email and leave links on disk.
     */
    EMAIL_OUTBOX_DIR: optionalString,
    /** Set to `1` by the end-to-end tests, which run a production build with an email outbox. */
    E2E_TESTS: z.preprocess(emptyToUndefined, z.literal('1').optional()),
    /** PostgreSQL connection string for the integration and end-to-end test database. */
    DATABASE_URL_TEST: z.preprocess(emptyToUndefined, z.url().optional()),
    /**
     * The port the end-to-end tests start their server on, for a checkout
     * that runs them next to another one; 3100 when it isn't set. The app
     * itself never reads it (`e2e/support/fixtures.ts` does).
     */
    E2E_PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1024).max(65535).optional(),
    ),
    /**
     * Request headers to read the client's IP address from, in order, e.g.
     * `x-real-ip` behind nginx or `cf-connecting-ip` behind Cloudflare. Used
     * for rate limits, the audit log and security emails. Defaults to
     * `x-forwarded-for` (right for Vercel); see "Client IP address" in
     * `docs/deploying.md`.
     */
    CLIENT_IP_HEADERS: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .default('x-forwarded-for')
        .transform((value) =>
          value
            .split(',')
            .map((header) => header.trim().toLowerCase())
            .filter(Boolean),
        ),
    ),
    /**
     * IP addresses or CIDR ranges of your reverse proxies, comma-separated, e.g.
     * `10.0.0.5,10.0.1.0/24`. With them, a forwarded chain is read from the
     * right, skipping these hops, so clients can't choose their own IP. Without
     * them, only a single-value IP header is trusted.
     */
    TRUSTED_PROXIES: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((value) =>
          (value ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        )
        .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),
    ),
    /** `1` on Vercel, which sets it itself: its disk doesn't keep files, and it caps request bodies. */
    VERCEL: optionalString,
    /**
     * Where attached files are kept (decision 0044, "Attachments" in
     * `docs/deploying.md`): `local` (a folder, `ATTACHMENTS_DIR`), `s3` (a
     * bucket, `ATTACHMENTS_S3_*`), `sftp` (a folder on another server,
     * `ATTACHMENTS_SFTP_*`), or `off`. Set, it wins over Settings, which
     * then only shows it; unset, Settings decides.
     */
    ATTACHMENTS_STORAGE: z.preprocess(
      emptyToUndefined,
      z.enum(['off', ...STORAGE_DRIVERS]).optional(),
    ),
    /** The folder for `local`, as an absolute path, e.g. `/data/attachments` (a volume in Docker). */
    ATTACHMENTS_DIR: optionalString,
    /** The S3-compatible service's address for `s3`, e.g. `https://<account>.r2.cloudflarestorage.com`. */
    ATTACHMENTS_S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
    /** The region requests are signed for (`auto` on R2); `us-east-1` when unset. */
    ATTACHMENTS_S3_REGION: optionalString,
    /** The bucket for `s3`, named by S3's own rules (`S3_BUCKET_PATTERN`). */
    ATTACHMENTS_S3_BUCKET: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(S3_BUCKET_PATTERN, 'Use 3 to 63 lowercase letters, digits, dots and dashes.')
        .optional(),
    ),
    /** The access key's ID for `s3`. */
    ATTACHMENTS_S3_ACCESS_KEY_ID: optionalString,
    /** The access key's secret for `s3`. */
    ATTACHMENTS_S3_SECRET_ACCESS_KEY: optionalString,
    /** `true` to put the bucket in the path rather than the host name, as most servers of your own need. */
    ATTACHMENTS_S3_FORCE_PATH_STYLE: z.preprocess(
      emptyToUndefined,
      z.enum(['true', 'false']).optional(),
    ),
    /** The SFTP server's host name or address, for `sftp`. */
    ATTACHMENTS_SFTP_HOST: optionalString,
    /** Its SSH port; 22 when unset. */
    ATTACHMENTS_SFTP_PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(65535).optional(),
    ),
    /** The user to sign in as, for `sftp`. */
    ATTACHMENTS_SFTP_USERNAME: optionalString,
    /** The user's password, unless it signs in with a key. */
    ATTACHMENTS_SFTP_PASSWORD: optionalString,
    /** The user's private key (PEM), in base64 so it fits on one line, unless it signs in with a password. */
    ATTACHMENTS_SFTP_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.base64().optional()),
    /**
     * The server's host key fingerprint, as `ssh-keygen -lf` prints it
     * (`SHA256:` and 43 characters); a connection to any other key is refused.
     */
    ATTACHMENTS_SFTP_HOST_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(HOST_KEY_PATTERN, 'Use the SHA256: fingerprint ssh-keygen -lf prints.')
        .optional(),
    ),
    /** The folder on the SFTP server, as an absolute path. */
    ATTACHMENTS_SFTP_DIR: optionalString,
    /**
     * The largest file anyone may attach, in megabytes (1 to 50, at most 4 on
     * Vercel). Set, it wins over Settings; unset, Settings decides (10 until
     * it's changed).
     */
    ATTACHMENTS_MAX_FILE_MB: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(MAX_FILE_MB).optional(),
    ),
    /**
     * Networks inside Adiutor's own that webhooks may still send to, as IP
     * addresses or CIDR ranges, comma-separated, e.g. `10.20.0.0/16` for a
     * receiver on the local network. Without it, webhooks never reach a
     * private, loopback or link-local address (`src/server/webhooks/address-guard.ts`).
     * Only the operator sets it: nobody in the app can widen it.
     */
    WEBHOOK_ALLOWED_NETWORKS: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((value) =>
          (value ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        )
        .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),
    ),
    /**
     * Node.js environment, set by Next.js (`development` for `next dev`,
     * `production` for `next build` and `next start`). Deliberately without a
     * default: scripts run without it are treated as neither, so they never
     * fall back to development behaviour such as printing emails.
     */
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  })
  .superRefine((value, ctx) => {
    // The storage rules, everywhere: what a driver needs, and where it may run (`storageProblems`).
    const vercel = value.VERCEL === '1';
    const storage = storageFromEnvironment(value);
    if (storage.state === 'incomplete') {
      for (const name of storage.missing) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message:
            name === 'ATTACHMENTS_SFTP_PASSWORD'
              ? 'Required, or ATTACHMENTS_SFTP_PRIVATE_KEY, when ATTACHMENTS_STORAGE is sftp.'
              : `Required when ATTACHMENTS_STORAGE is ${value.ATTACHMENTS_STORAGE}.`,
        });
      }
    }
    if (storage.state === 'set') {
      const surroundings = { production: value.NODE_ENV === 'production', vercel };
      for (const problem of storageProblems(storage.config, surroundings)) {
        const issue = STORAGE_PROBLEM_ISSUES[problem];
        // An SFTP folder is a variable of its own.
        const path =
          problem === 'relative_folder' && storage.config.driver === 'sftp'
            ? ['ATTACHMENTS_SFTP_DIR']
            : issue.path;
        ctx.addIssue({ code: 'custom', path, message: issue.message });
      }
    }
    const ceiling = maxFileMbCeiling(vercel);
    if (value.ATTACHMENTS_MAX_FILE_MB && value.ATTACHMENTS_MAX_FILE_MB > ceiling) {
      ctx.addIssue({
        code: 'custom',
        path: ['ATTACHMENTS_MAX_FILE_MB'],
        message: `At most ${ceiling} on Vercel, which refuses larger request bodies.`,
      });
    }
  })
  .superRefine((value, ctx) => {
    // The production rules; development, tests and scripts without NODE_ENV aren't affected.
    if (value.NODE_ENV !== 'production') {
      return;
    }
    if (value.EMAIL_OUTBOX_DIR && value.E2E_TESTS !== '1') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_OUTBOX_DIR'],
        message: 'Only for automated tests; leave it empty in production.',
      });
    }
    const appUrl = parsedUrl(value.BETTER_AUTH_URL);
    if (appUrl && !isProductionAppUrl(appUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['BETTER_AUTH_URL'],
        message:
          'Use an https:// address in production, e.g. https://adiutor.dev; http:// only works for localhost.',
      });
    }
    const smtpUrl = parsedUrl(value.SMTP_URL);
    if (smtpUrl && !isProductionSmtpUrl(smtpUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message:
          'Use TLS in production: smtps://… (usually port 465), or add ?requireTLS=true to an smtp:// URL (STARTTLS, usually port 587).',
      });
    }
  });

/** Validated environment variables. */
export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates environment variables.
 *
 * @param source - The variables to validate. Defaults to `process.env`.
 * @returns The validated variables.
 * @throws {Error} If a variable is missing or invalid, listing every problem.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
