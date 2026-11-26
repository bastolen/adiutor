/**
 * @file The shared frame of every email: logo, white card and footer, in the
 * recipient's language.
 */
import type { ReactNode } from 'react';
import { Body, Container, Head, Html, Img, Preview, Section, Text } from 'react-email';

import type { EmailBrand } from '@/emails/base-props';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';

import { EmailLink } from './email-text';
import { type EmailColours, emailColours, fontFamily, small } from './theme';

/**
 * The footer's link to the app, for the `<link>` tag of
 * `emails.layout.sentBy` ("Sent by <link>Adiutor</link>").
 *
 * @param href - The app's URL.
 * @param colours - The email's colours.
 */
function appLinkTag(href: string, colours: EmailColours) {
  return function linkTag(chunks: ReactNode) {
    return (
      <EmailLink href={href} tone="muted" underline colours={colours}>
        {chunks}
      </EmailLink>
    );
  };
}

/**
 * Props for {@link EmailLayout}.
 */
interface EmailLayoutProps {
  /** Short summary shown after the subject in the inbox. */
  preview: string;
  /** Public base URL of the app (no trailing slash), for the logo and the footer link. */
  appUrl: string;
  /** The recipient's language: the document's `lang` and the footer's text. */
  locale: Locale;
  /** Why the recipient gets this email, shown in the footer. */
  reason: ReactNode;
  /** Logo image URL. Defaults to `{appUrl}/brand/logo.png`; the template preview overrides it. */
  logoSrc?: string;
  /** The brand colours to draw the email with; the theme's own without. */
  brand?: EmailBrand;
  /** The email's content. */
  children: ReactNode;
}

/**
 * Wraps an email's content in the Adiutor frame: the logo on a soft grey
 * background, the content in a white card, and a footer saying why the email
 * was sent, with a link to the app.
 *
 * The logo is linked, not attached. Clients that block remote images show
 * its alt text instead, styled as the wordmark, and the fixed size keeps the
 * layout in place.
 */
export default function EmailLayout({
  preview,
  appUrl,
  locale,
  reason,
  logoSrc = undefined,
  brand = undefined,
  children,
}: EmailLayoutProps) {
  const colors = emailColours(brand);
  const t = translator(locale, 'emails.layout');
  return (
    <Html lang={locale} dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, backgroundColor: colors.background, fontFamily }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 16px' }}>
          <Section style={{ padding: '0 8px 24px' }}>
            <Img
              src={logoSrc ?? `${appUrl}/brand/logo.png`}
              width="140"
              height="32"
              alt={t('logoAlt')}
              style={{
                color: colors.primary,
                fontSize: '22px',
                fontWeight: 700,
                lineHeight: '32px',
              }}
            />
          </Section>
          <Section
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: '12px',
              padding: '32px',
            }}
          >
            {children}
          </Section>
          <Section style={{ padding: '24px 8px 0' }}>
            <Text style={{ ...small(colors), marginBottom: '8px' }}>{reason}</Text>
            <Text style={small(colors)}>
              {t.rich('sentBy', { link: appLinkTag(appUrl, colors) })}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
