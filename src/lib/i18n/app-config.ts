/**
 * @file Tells next-intl which languages and messages exist, so TypeScript
 * checks every locale and every message key: a key that isn't in the
 * English (US) catalogues fails `pnpm typecheck`.
 * @see https://next-intl.dev/docs/workflows/typescript
 */
import type { Locale } from './locales';
import type { Messages } from './messages';

declare module 'next-intl' {
  /** next-intl's types for this app. */
  interface AppConfig {
    /** One of `LOCALES`. */
    Locale: Locale;
    /** Every message, in the shape of the English (US) catalogues. */
    Messages: Messages;
  }
}
