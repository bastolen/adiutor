/**
 * @file The shared frame of every email: logo, white card and footer.
 */
import type { ReactNode } from 'react';
import { Body, Container, Head, Html, Img, Link, Preview, Section, Text } from 'react-email';

import { colors, fontFamily, small } from './theme';

/**
 * Props for {@link EmailLayout}.
 */
interface EmailLayoutProps {
  /** Short summary shown after the subject in the inbox. */
  preview: string;
  /** Public base URL of the app (no trailing slash), for the logo and the footer link. */
  appUrl: string;
  /** Why the recipient gets this email, shown in the footer. */
  reason: ReactNode;
  /** Logo image URL. Defaults to `{appUrl}/brand/logo.png`; the template preview overrides it. */
  logoSrc?: string;
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
 *
 * @param props - Layout props.
 * @param props.preview - Inbox preview text.
 * @param props.appUrl - Public app URL.
 * @param props.reason - Footer explanation.
 * @param props.logoSrc - Logo URL override.
 * @param props.children - The content.
 * @returns The email document.
 */
export default function EmailLayout({
  preview,
  appUrl,
  reason,
  logoSrc = undefined,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, backgroundColor: colors.background, fontFamily }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 16px' }}>
          <Section style={{ padding: '0 8px 24px' }}>
            <Img
              src={logoSrc ?? `${appUrl}/brand/logo.png`}
              width="140"
              height="32"
              alt="Adiutor"
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
            <Text style={{ ...small, marginBottom: '8px' }}>{reason}</Text>
            <Text style={small}>
              Sent by{' '}
              <Link href={appUrl} style={{ color: colors.muted, textDecoration: 'underline' }}>
                Adiutor
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
