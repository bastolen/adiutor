/**
 * @file Text building blocks for emails: heading, paragraph, note and the
 * link to copy when the button doesn't work.
 */
import type { ReactNode } from 'react';
import { Heading, Link, Text } from 'react-email';

import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';

import { colors, paragraph, small } from './theme';

/**
 * The email's main heading.
 *
 * @param props - Heading props.
 * @param props.children - Heading text.
 */
export function EmailHeading({ children }: { children: ReactNode }) {
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
 */
export function EmailParagraph({ children }: { children: ReactNode }) {
  return <Text style={paragraph}>{children}</Text>;
}

/**
 * A short, secondary note, e.g. how long a link stays valid.
 *
 * @param props - Note props.
 * @param props.children - The text.
 */
export function EmailNote({ children }: { children: ReactNode }) {
  return <Text style={{ ...small, marginBottom: '16px' }}>{children}</Text>;
}

/**
 * The button's link, for the `<link>` tag of `emails.linkFallback`.
 *
 * @param href - The link.
 */
function fallbackLinkTag(href: string) {
  return function linkTag(chunks: ReactNode) {
    return (
      <Link href={href} style={{ color: colors.primary }}>
        {chunks}
      </Link>
    );
  };
}

/**
 * The button's link written out, for when the button doesn't work.
 *
 * @param props - Fallback props.
 * @param props.url - The button's link.
 * @param props.locale - The recipient's language.
 */
export function LinkFallback({ url, locale }: { url: string; locale: Locale }) {
  return (
    <Text style={{ ...small, wordBreak: 'break-all' }}>
      {translator(locale, 'emails').rich('linkFallback', { url, link: fallbackLinkTag(url) })}
    </Text>
  );
}
