/**
 * @file Tests for the account row on sign-in pages: it shows the whole name
 * and address, however long, names accounts in running text, and tells when
 * two accounts have the same name.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AccountSummary, { accountLabel, sameName } from './account-summary';

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

describe('sameName', () => {
  it('matches names that differ only in case and surrounding spaces', () => {
    expect(
      sameName(
        { name: 'Jane Tester', email: 'jane.t@adiutor.test' },
        { name: ' jane tester ', email: 'jane@adiutor.test' },
      ),
    ).toBe(true);
  });

  it("doesn't match names that differ, or that are both empty", () => {
    expect(
      sameName(
        { name: 'Jane Tester', email: 'jane@adiutor.test' },
        { name: 'Alex Tester', email: 'alex@adiutor.test' },
      ),
    ).toBe(false);
    expect(
      sameName({ name: '', email: 'jane@adiutor.test' }, { name: ' ', email: 'alex@adiutor.test' }),
    ).toBe(false);
  });
});
