/**
 * @file Tests for the menu that Sort and the filters share: its button names
 * it (by what it shows, or by its label when it shows less), choosing an
 * option navigates without scrolling, and the button is busy meanwhile.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SortOption } from '@/lib/tables/table-state';

import LinkRadioMenu from './link-radio-menu';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router; choosing an option pushes its link.
   *
   * @returns The router.
   */
  useRouter: () => ({ push }),
}));

vi.mock('next/link', () => ({
  /**
   * A plain anchor that reports a click to `onNavigate`, as Next.js's link does in the app.
   *
   * @param props - The link's props.
   * @param props.href - Where it goes.
   * @param props.onNavigate - Called with the click.
   * @param props.scroll - Dropped: a plain anchor has no use for it.
   * @param props.children - The label.
   * @returns The anchor.
   */
  default: ({
    href,
    onNavigate,
    scroll: _scroll,
    children,
    ...rest
  }: {
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
    scroll?: boolean;
    children: ReactNode;
  }) => (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onNavigate?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

/** Two choices, the first one current. */
const OPTIONS: readonly SortOption[] = [
  { value: 'a', label: 'Alpha', href: '/list?x=a', current: true },
  { value: 'b', label: 'Beta', href: '/list?x=b', current: false },
];

describe('LinkRadioMenu', () => {
  it('shows the trigger content for the current choice and is not busy at first', () => {
    render(
      <LinkRadioMenu
        icon={Check}
        align="start"
        menuLabel="Pick one"
        options={OPTIONS}
        renderTrigger={(current) => `Now: ${current?.label}`}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Now: Alpha' });
    expect(trigger).not.toHaveAttribute('aria-busy');
  });

  it('is named by what it shows, and so is its menu', async () => {
    const user = userEvent.setup();
    render(
      <LinkRadioMenu
        icon={Check}
        align="start"
        menuLabel="Pick one"
        options={OPTIONS}
        renderTrigger={(current) => `Now: ${current?.label}`}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Now: Alpha' });
    expect(trigger).not.toHaveAttribute('aria-label');
    await user.click(trigger);
    expect(screen.getByRole('menu')).toHaveAccessibleName('Now: Alpha');
  });

  it('names its button, and so its menu, with its label when it shows less', async () => {
    const user = userEvent.setup();
    render(
      <LinkRadioMenu
        icon={Check}
        align="start"
        menuLabel="Pick one"
        options={OPTIONS}
        renderTrigger={(current) => current?.label}
        triggerLabel={(current) => `Pick a letter: ${current?.label}`}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Pick a letter: Alpha' });
    expect(trigger).toHaveAttribute('aria-label', 'Pick a letter: Alpha');
    expect(trigger).toHaveTextContent(/^Alpha$/);
    await user.click(trigger);
    expect(screen.getByRole('menu')).toHaveAccessibleName('Pick a letter: Alpha');
  });

  it('pushes the chosen link without scrolling and is busy until it settles', async () => {
    const user = userEvent.setup();
    const navigation = Promise.withResolvers<void>();
    push.mockImplementationOnce(() => navigation.promise);
    render(
      <LinkRadioMenu
        icon={Check}
        align="end"
        menuLabel="Pick one"
        options={OPTIONS}
        renderTrigger={(current) => `Now: ${current?.label}`}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Now: Alpha' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Beta' }));

    expect(push).toHaveBeenCalledWith('/list?x=b', { scroll: false });
    expect(screen.getByRole('button', { name: 'Now: Alpha', hidden: true })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await act(async () => {
      navigation.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Now: Alpha', hidden: true })).not.toHaveAttribute(
      'aria-busy',
    );
  });
});
