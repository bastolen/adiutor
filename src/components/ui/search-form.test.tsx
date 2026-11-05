/**
 * @file Tests for the search form: a named search landmark that sends `q`
 * with the fields to keep, and a Search button that is busy while the results
 * load without losing focus.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import SearchForm from './search-form';

/** A search that never finishes, so the form stays busy. */
const { search } = vi.hoisted(() => ({
  search: vi.fn((_formData: FormData) => new Promise<void>(() => {})),
}));

vi.mock('next/form', () => ({
  /**
   * `next/form` as a plain form whose action is {@link search}.
   *
   * @param props - The props the search form passes.
   * @param props.children - The fields.
   * @param props.role - The landmark role.
   * @param props.className - Classes.
   * @returns The form.
   */
  default: ({
    children,
    role,
    className,
    ...props
  }: {
    children: ReactNode;
    role: string;
    className: string;
    'aria-label': string;
  }) => (
    <form role={role} aria-label={props['aria-label']} className={className} action={search}>
      {children}
    </form>
  ),
}));

describe('SearchForm', () => {
  it('is a named search landmark that sends the text as `q` with the fields to keep', async () => {
    const user = userEvent.setup();
    render(
      <SearchForm
        id="user-search"
        label="Search users"
        placeholder="Search by name or email"
        defaultValue="jane"
        hiddenFields={{ filter: 'staff', sort: 'email' }}
      />,
    );

    expect(screen.getByRole('search', { name: 'Search users' })).toBeInTheDocument();
    const field = screen.getByRole('searchbox', { name: 'Search users' });
    expect(field).toHaveValue('jane');
    await user.clear(field);
    await user.type(field, 'adiutor');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(Object.fromEntries(defined(search.mock.calls[0], 'the first call')[0])).toEqual({
      filter: 'staff',
      sort: 'email',
      q: 'adiutor',
    });
  });

  it('shows the Search button busy while the results load, still enabled and focused', async () => {
    const user = userEvent.setup();
    render(<SearchForm id="company-search" label="Search companies" placeholder="Search" />);

    const button = screen.getByRole('button', { name: 'Search' });
    expect(button).not.toHaveAttribute('aria-busy');
    await user.click(button);

    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
  });
});
