/**
 * @file The main call-to-action button in emails.
 */
import type { ReactNode } from 'react';
import { Button, Section } from 'react-email';

import { colors } from './theme';

/**
 * Props for {@link EmailButton}.
 */
interface EmailButtonProps {
  /** Where the button goes. */
  href: string;
  /** Button text. */
  children: ReactNode;
}

/**
 * A brand-teal button with white text. React Email's `Button` adds the
 * workarounds that keep its padding in Outlook.
 *
 * @param props - Button props.
 * @param props.href - Link target.
 * @param props.children - Button text.
 * @returns The button.
 */
export default function EmailButton({ href, children }: EmailButtonProps) {
  return (
    <Section style={{ margin: '8px 0 24px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: colors.primary,
          borderRadius: '8px',
          color: colors.primaryForeground,
          fontSize: '15px',
          fontWeight: 600,
          lineHeight: '20px',
          padding: '12px 20px',
          textDecoration: 'none',
        }}
      >
        {children}
      </Button>
    </Section>
  );
}
