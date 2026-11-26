/**
 * @file A one-time code in emails, shown large in a soft box so it's easy to
 * read and type over.
 */
import { Section, Text } from 'react-email';

import { type EmailColours, monoFontFamily } from './theme';

/**
 * Props for {@link EmailCode}.
 */
interface EmailCodeProps {
  /** The code, e.g. "482915". */
  code: string;
  /** The email's colours (`emailColours(props.brand)`). */
  colours: EmailColours;
}

/**
 * The code centred in a bordered box on the email's background colour, in
 * large, widely spaced monospace digits.
 */
export default function EmailCode({ code, colours: colors }: EmailCodeProps) {
  return (
    <Section
      style={{
        margin: '0 0 24px',
        padding: '16px',
        backgroundColor: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        textAlign: 'center',
      }}
    >
      <Text
        style={{
          margin: 0,
          color: colors.foreground,
          fontFamily: monoFontFamily,
          fontSize: '32px',
          fontWeight: 700,
          letterSpacing: '0.3em',
          lineHeight: '40px',
        }}
      >
        {code}
      </Text>
    </Section>
  );
}
