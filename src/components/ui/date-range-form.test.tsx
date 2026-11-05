/**
 * @file Tests for the date range form: two labelled date fields with the
 * current dates, the other query parameters kept when it's submitted, and
 * Clear only once a date is set.
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import DateRangeForm from './date-range-form';

vi.mock('next/form', () => ({
  /**
   * `next/form` as a plain form, which needs no app router.
   *
   * @param props - The props the date range form passes.
   * @param props.children - The fields.
   * @param props.className - Classes.
   * @returns The form.
   */
  default: ({
    children,
    className,
    ...props
  }: {
    children: ReactNode;
    className: string;
    'aria-label': string;
  }) => (
    <form aria-label={props['aria-label']} className={className}>
      {children}
    </form>
  ),
}));

describe('DateRangeForm', () => {
  it('shows the current dates in labelled date fields, and keeps the other parameters', () => {
    render(
      <DateRangeForm
        label="Filter by date"
        from="2026-11-01"
        to="2026-11-03"
        hiddenFields={{ q: 'jane', group: 'sign-ins' }}
        clearHref="/admin/logs?group=sign-ins&q=jane"
      />,
    );

    const form = screen.getByRole('form', { name: 'Filter by date' });
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-03');
    expect(Object.fromEntries(new FormData(form as HTMLFormElement))).toEqual({
      q: 'jane',
      group: 'sign-ins',
      from: '2026-11-01',
      to: '2026-11-03',
    });
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute(
      'href',
      '/admin/logs?group=sign-ins&q=jane',
    );
  });

  it('leaves Clear out while no date is set', () => {
    render(<DateRangeForm label="Filter by date" clearHref="/admin/logs" />);

    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.queryByRole('link', { name: 'Clear' })).not.toBeInTheDocument();
  });
});
