/**
 * @file Tests for the text link: underlined inside a sentence, so it's told
 * apart from the text around it by more than its colour, and underlined on
 * hover only when it stands on its own.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TextLink from './text-link';

describe('TextLink', () => {
  it('is a link to its address', () => {
    render(<TextLink href="/account/security">Security page</TextLink>);

    expect(screen.getByRole('link', { name: 'Security page' })).toHaveAttribute(
      'href',
      '/account/security',
    );
  });

  it('is underlined inside a sentence, thinly at rest and thicker on hover', () => {
    render(
      <p>
        Disconnect it on the <TextLink href="/account/security">Security page</TextLink>.
      </p>,
    );

    const link = screen.getByRole('link', { name: 'Security page' });
    expect(link).toHaveClass('underline', 'decoration-1', 'hover:decoration-2');
    // The underline is there before the pointer is: colour alone doesn't mark the link.
    expect(link).not.toHaveClass('hover:underline');
  });

  it('is underlined on hover only when it stands on its own', () => {
    render(
      <TextLink standalone href="/auth/forgot-password">
        Forgot password?
      </TextLink>,
    );

    const link = screen.getByRole('link', { name: 'Forgot password?' });
    expect(link).toHaveClass('hover:underline');
    expect(link).not.toHaveClass('underline');
    expect(link).not.toHaveClass('decoration-1');
    // The prop is the component's own, not an attribute of the link.
    expect(link).not.toHaveAttribute('standalone');
  });

  it.each([false, true])(
    'keeps the highlight colour, the focus ring and its tap height (standalone: %s)',
    (standalone) => {
      render(
        <TextLink standalone={standalone} href="/admin/settings/staff">
          Staff settings
        </TextLink>,
      );

      expect(screen.getByRole('link', { name: 'Staff settings' })).toHaveClass(
        'text-highlight',
        'font-medium',
        'underline-offset-4',
        'focus-visible:outline-2',
        'py-0.5',
        '-my-0.5',
      );
    },
  );

  it('takes extra classes', () => {
    render(
      <TextLink standalone href="/companies/adiutor-tests" className="wrap-anywhere">
        Adiutor Tests
      </TextLink>,
    );

    expect(screen.getByRole('link', { name: 'Adiutor Tests' })).toHaveClass(
      'wrap-anywhere',
      'text-highlight',
    );
  });
});
