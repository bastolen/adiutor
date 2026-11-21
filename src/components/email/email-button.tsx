/**
 * @file The call-to-action buttons in emails: the main one, and a quieter
 * one beside it for a second choice.
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
  /** `primary` (the default) for the main action; `secondary` for a second choice beside it. */
  variant?: 'primary' | 'secondary';
}

/**
 * A brand-teal button with white text, or for a second choice a white one
 * with brand-teal text and border. React Email's `Button` adds the
 * workarounds that keep its padding in Outlook.
 *
 * @param props - Button props.
 * @param props.href - Link target.
 * @param props.children - Button text.
 * @param props.variant - The main action, or a second choice.
 * @returns The button.
 */
export default function EmailButton({ href, children, variant = 'primary' }: EmailButtonProps) {
  const primary = variant === 'primary';
  return (
    <Section style={{ margin: '8px 0 24px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: primary ? colors.primary : colors.surface,
          border: `1px solid ${colors.primary}`,
          borderRadius: '8px',
          color: primary ? colors.primaryForeground : colors.primary,
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
