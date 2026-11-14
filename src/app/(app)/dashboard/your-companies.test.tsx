/**
 * @file Tests for the "Your companies" card on a company user's dashboard:
 * a link to each company's page with the user's role, and a title that says
 * whether it's one company or several.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import YourCompanies from './your-companies';

describe('YourCompanies', () => {
  it("links to each company's page, in the order given, with the user's role in it", () => {
    render(
      <YourCompanies
        companies={[
          { slug: 'adiutor-tests', name: 'Adiutor Tests', role: 'admin' },
          { slug: 'adiutor-tests-paging', name: 'Adiutor Tests Paging', role: 'watcher' },
        ]}
      />,
    );

    const card = screen.getByRole('region', { name: 'Your companies' });
    expect(card).toHaveTextContent('Open one to see its requests.');
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByRole('link', { name: 'Adiutor Tests' }),
    ).toHaveAttribute('href', '/companies/adiutor-tests');
    expect(rows[0]).toHaveTextContent('Admin');
    expect(
      within(rows[1] as HTMLElement).getByRole('link', { name: 'Adiutor Tests Paging' }),
    ).toHaveAttribute('href', '/companies/adiutor-tests-paging');
    expect(rows[1]).toHaveTextContent('Watcher');
  });

  it('names the card after the one company of someone who is in one', () => {
    render(
      <YourCompanies
        companies={[{ slug: 'adiutor-tests', name: 'Adiutor Tests', role: 'client' }]}
      />,
    );

    const card = screen.getByRole('region', { name: 'Your company' });
    expect(card).toHaveTextContent('Open it to see its requests.');
    expect(within(card).getByRole('listitem')).toHaveTextContent('Client');
  });

  it('names links by the company alone, so the role is not read as part of it', () => {
    render(
      <YourCompanies
        companies={[{ slug: 'adiutor-tests', name: 'Adiutor Tests', role: 'client' }]}
      />,
    );

    expect(screen.getByRole('link')).toHaveAccessibleName('Adiutor Tests');
  });
});
