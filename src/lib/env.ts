/**
 * @file Server-side environment variables, validated once at startup.
 *
 * Import `env` instead of reading `process.env` directly, so missing or
 * invalid configuration fails fast with a clear error. See `.env.example` for
 * every variable, and `env-schema.ts` for the rules.
 */
import { parseEnv } from './env-schema';

/** The app's validated environment variables. */
export const env = parseEnv();

/** The app's public URL without a trailing slash, for links in emails (from `BETTER_AUTH_URL`). */
export const appUrl = env.BETTER_AUTH_URL.replace(/\/$/, '');
