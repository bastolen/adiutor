/**
 * @file The props and example data every email template shares, so each
 * template only declares what is its own.
 */

/**
 * Props every email template takes. Templates extend it with their own
 * (`interface MagicLinkEmailProps extends EmailBaseProps { url: string }`).
 */
export interface EmailBaseProps {
  /** Public app URL (no trailing slash). */
  appUrl: string;
  /** Logo URL override, for the template preview. */
  logoSrc?: string;
}

/**
 * The part of the template preview's example data (`PreviewProps`) every
 * template shares: the Adiutor app URL and the logo in `src/emails/static/`.
 * Spread it first: `PreviewProps = { ...PREVIEW_BASE, url: '…' }`.
 */
export const PREVIEW_BASE = {
  appUrl: 'https://adiutor.dev',
  logoSrc: '/static/logo.png',
} satisfies EmailBaseProps;
