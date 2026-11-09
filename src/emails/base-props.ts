/**
 * @file The props and example data every email template shares, so each
 * template only declares what is its own.
 */
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

/**
 * Props every email template takes. Templates extend it with their own
 * (`interface MagicLinkEmailProps extends EmailBaseProps { url: string }`).
 */
export interface EmailBaseProps {
  /** Public app URL (no trailing slash). */
  appUrl: string;
  /**
   * The recipient's language: the email's text, its subject, its dates and
   * its `lang` (which language each email uses: docs/email.md).
   */
  locale: Locale;
  /** Logo URL override, for the template preview. */
  logoSrc?: string;
}

/**
 * The part of the template preview's example data (`PreviewProps`) every
 * template shares: the Adiutor app URL, English (US) and the logo in
 * `src/emails/static/`. Spread it first: `PreviewProps = { ...PREVIEW_BASE, url: '…' }`.
 */
export const PREVIEW_BASE = {
  appUrl: 'https://adiutor.dev',
  locale: DEFAULT_LOCALE,
  logoSrc: '/static/logo.png',
} satisfies EmailBaseProps;
