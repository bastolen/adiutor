/**
 * @file Schema and parser for the server-side environment variables.
 *
 * Kept separate from `env.ts`, which parses `process.env` as soon as it's
 * imported, so the parsing rules can be tested on their own. With
 * `NODE_ENV=production`, it also refuses settings only fit for development:
 * an email outbox, an `http://` app URL and SMTP without TLS (both allowed on
 * this computer, where the end-to-end tests run a production build).
 */
import { z } from 'zod';

import isLocalHostname from './local-host';
import { parseAuthSecrets } from './sign-in/auth-secrets';

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
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHostname(url.hostname));
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
    /** PostgreSQL connection string for accounts and sessions. */
    DATABASE_URL: z.url(),
    /**
     * Secret used by Better Auth to sign and encrypt; at least 32 characters.
     * With `BETTER_AUTH_SECRETS` set, it only decrypts older data.
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
     * endpoint is off (see "Background jobs" in `docs/deploying.md`).
     */
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
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
     * SMTP connection URL for sending email, e.g.
     * `smtps://user:password@smtp.adiutor.dev:465`, or
     * `smtp://user:password@smtp.adiutor.dev:587?requireTLS=true` for STARTTLS.
     * In production it must use TLS, except to a server on this computer
     * ({@link isProductionSmtpUrl}). Without it, emails are printed to the
     * server console (development only).
     */
    SMTP_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    /** Sender address for outgoing email. */
    EMAIL_FROM: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default('Adiutor <no-reply@adiutor.dev>'),
    ),
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
    /**
     * Node.js environment, set by Next.js (`development` for `next dev`,
     * `production` for `next build` and `next start`). Deliberately without a
     * default: scripts run without it are treated as neither, so they never
     * fall back to development behaviour such as printing emails.
     */
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
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
