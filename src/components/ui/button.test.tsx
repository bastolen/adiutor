/**
 * @file Tests for the button.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import Button from './button';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('is busy and disabled while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not marked busy when idle', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
  });

  it('never grows wider than its container: a long label wraps and the button grows taller', () => {
    render(
      <>
        <Button>Save</Button>
        <Button fullWidth>Liever inloggen met een e-maillink</Button>
      </>,
    );

    // Growing from the usual height rather than spilling past a card's or a narrow screen's edge.
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveClass('max-w-full', 'min-h-10');
    expect(save).not.toHaveClass('h-10', 'whitespace-nowrap', 'w-full');
    expect(screen.getByRole('button', { name: 'Liever inloggen met een e-maillink' })).toHaveClass(
      'w-full',
      'max-w-full',
      'min-h-10',
    );
  });

  it('can render a link that looks like a button', () => {
    render(
      <Button asChild>
        <a href="https://adiutor.dev">Open</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      'https://adiutor.dev',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('can be a decorative picture of a button without any interaction', () => {
    const { container } = render(<Button decorative>Approve</Button>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const look = defined(container.firstElementChild, 'the look of the button');
    expect(look.tagName).toBe('SPAN');
    expect(look).toHaveAttribute('aria-hidden', 'true');
    expect(look.className).not.toMatch(/hover:|focus-visible:|active:/);
    expect(look).toHaveClass('pointer-events-none', 'bg-primary');
  });
});
