/**
 * @file Tests for the button.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import Button, { whileRunning } from './button';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('is busy while loading without giving up focus: it ignores presses instead of being disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();

    rerender(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    // A disabled button loses focus the moment it's disabled, and doesn't get it back.
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();

    rerender(<Button onClick={onClick}>Save</Button>);
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not submit its form again while loading, from the button or from Enter in a field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <input aria-label="Name" />
        <Button type="submit" loading>
          Save
        </Button>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Adiutor Tests{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <form onSubmit={onSubmit}>
        <input aria-label="Name" />
        <Button type="submit">Save</Button>
      </form>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('is disabled when asked to be, which a busy state does not change', () => {
    render(
      <Button disabled loading>
        Save
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
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

describe('whileRunning', () => {
  it('leaves every button usable while nothing runs', () => {
    expect(whileRunning(null, 'passkey')).toEqual({ loading: false, disabled: false });
  });

  it('makes the running action busy, so its button keeps focus', () => {
    expect(whileRunning('passkey', 'passkey')).toEqual({ loading: true, disabled: false });
  });

  it('disables the other actions, which show no spinner', () => {
    expect(whileRunning<string>('passkey', 'github')).toEqual({ loading: false, disabled: true });
  });
});
