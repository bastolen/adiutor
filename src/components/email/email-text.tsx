/**
 * @file Text building blocks for emails: heading, paragraph, note and the
 * link to copy when the button doesn't work.
 */
import type { ReactNode } from 'react';
import { Heading, Link, Text } from 'react-email';

import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';

import { type EmailColours, paragraph, small } from './theme';

/**
 * The email's main heading.
 *
 * @param props - Heading props.
 * @param props.children - Heading text.
 * @param props.colours - The email's colours (`emailColours(props.brand)`).
 */
export function EmailHeading({
  children,
  colours: colors,
}: {
  children: ReactNode;
  colours: EmailColours;
}) {
  return (
    <Heading
      as="h1"
      style={{
        margin: '0 0 16px',
        color: colors.foreground,
        fontSize: '22px',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: '30px',
      }}
    >
      {children}
    </Heading>
  );
}

/**
 * A paragraph of body text.
 *
 * @param props - Paragraph props.
 * @param props.children - The text.
 * @param props.colours - The email's colours (`emailColours(props.brand)`).
 */
export function EmailParagraph({
  children,
  colours,
}: {
  children: ReactNode;
  colours: EmailColours;
}) {
  return <Text style={paragraph(colours)}>{children}</Text>;
}

/**
 * A short, secondary note, e.g. how long a link stays valid.
 *
 * @param props - Note props.
 * @param props.children - The text.
 * @param props.colours - The email's colours (`emailColours(props.brand)`).
 */
export function EmailNote({ children, colours }: { children: ReactNode; colours: EmailColours }) {
  return <Text style={{ ...small(colours), marginBottom: '16px' }}>{children}</Text>;
}

/**
 * A link in the email's own words, in the brand's colours.
 *
 * @param props - Link props.
 * @param props.href - Where it goes.
 * @param props.tone - `primary` for the brand's colour, `muted` for the secondary text's.
 * @param props.bold - Whether the link is semibold.
 * @param props.underline - Whether the link is underlined.
 * @param props.children - The link's text.
 * @param props.colours - The email's colours (`emailColours(props.brand)`).
 */
export function EmailLink({
  href,
  tone,
  bold = false,
  underline = false,
  children,
  colours,
}: {
  href: string;
  tone: 'primary' | 'muted';
  bold?: boolean;
  underline?: boolean;
  children: ReactNode;
  colours: EmailColours;
}) {
  return (
    <Link
      href={href}
      style={{
        color: colours[tone],
        ...(bold ? { fontWeight: 600 } : {}),
        ...(underline ? { textDecoration: 'underline' } : {}),
      }}
    >
      {children}
    </Link>
  );
}

/**
 * The button's link, for the `<link>` tag of `emails.linkFallback`.
 *
 * @param href - The link.
 * @param colours - The email's colours.
 */
function fallbackLinkTag(href: string, colours: EmailColours) {
  return function linkTag(chunks: ReactNode) {
    return (
      <EmailLink href={href} tone="primary" colours={colours}>
        {chunks}
      </EmailLink>
    );
  };
}

/**
 * The button's link written out, for when the button doesn't work.
 *
 * @param props - Fallback props.
 * @param props.url - The button's link.
 * @param props.locale - The recipient's language.
 * @param props.colours - The email's colours (`emailColours(props.brand)`).
 */
export function LinkFallback({
  url,
  locale,
  colours,
}: {
  url: string;
  locale: Locale;
  colours: EmailColours;
}) {
  return (
    <Text style={{ ...small(colours), wordBreak: 'break-all' }}>
      {translator(locale, 'emails').rich('linkFallback', {
        url,
        link: fallbackLinkTag(url, colours),
      })}
    </Text>
  );
}
