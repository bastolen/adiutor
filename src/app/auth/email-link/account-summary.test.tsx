/**
 * @file Tests for the account row on sign-in pages: it shows the whole name
 * and address, however long, and names accounts in running text.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AccountSummary, { accountLabel } from './account-summary';

describe('AccountSummary', () => {
  it('wraps a long name and address instead of cutting off the domain', () => {
    const email = 'jane@adiutor.test.eu-west-1.mail-relay.adiutor-tests.test';
    render(<AccountSummary name="Jane Tester of Adiutor Tests, Support" email={email} />);

    expect(screen.getByText(email)).toHaveClass('break-all');
    expect(screen.getByText(email)).not.toHaveClass('truncate');
    expect(screen.getByText('Jane Tester of Adiutor Tests, Support')).not.toHaveClass('truncate');
  });

  it('leaves out an empty name', () => {
    render(<AccountSummary name="" email="jane@adiutor.test" />);

    expect(screen.getByText('jane@adiutor.test').parentElement?.children).toHaveLength(1);
  });
});

describe('accountLabel', () => {
  it('names an account by name and address, or by its address alone', () => {
    expect(accountLabel({ name: 'Jane Tester', email: 'jane@adiutor.test' })).toBe(
      'Jane Tester (jane@adiutor.test)',
    );
    expect(accountLabel({ name: '', email: 'jane@adiutor.test' })).toBe('jane@adiutor.test');
  });
});
