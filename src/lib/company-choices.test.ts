/**
 * @file Tests for the labels of companies where someone picks one.
 */
import { describe, expect, it } from 'vitest';

import { companyChoiceLabels } from './company-choices';

/**
 * The label a caller would pass for a company with its URL name.
 *
 * @param company - The company.
 * @param company.name - Its name.
 * @param company.slug - Its URL name.
 * @returns The label.
 */
const withUrlName = ({ name, slug }: { name: string; slug: string }) => `${name} (${slug})`;

describe('companyChoiceLabels', () => {
  it('labels companies with different names by their names', () => {
    expect(
      companyChoiceLabels(
        [
          { name: 'Adiutor Tests', slug: 'adiutor-tests' },
          { name: 'Adiutor Tests Paging', slug: 'adiutor-tests-paging' },
        ],
        withUrlName,
      ).map(({ label }) => label),
    ).toEqual(['Adiutor Tests', 'Adiutor Tests Paging']);
  });

  it('adds the URL name to each company whose name another shares, keeping the order', () => {
    expect(
      companyChoiceLabels(
        [
          { name: 'Adiutor Tests', slug: 'adiutor-tests' },
          { name: 'Adiutor Tests Paging', slug: 'adiutor-tests-paging' },
          { name: 'Adiutor Tests', slug: 'adiutor-tests-north' },
        ],
        withUrlName,
      ).map(({ label }) => label),
    ).toEqual([
      'Adiutor Tests (adiutor-tests)',
      'Adiutor Tests Paging',
      'Adiutor Tests (adiutor-tests-north)',
    ]);
  });

  it('counts names that differ only in case or spaces around them as the same', () => {
    expect(
      companyChoiceLabels(
        [
          { name: 'Adiutor Tests', slug: 'adiutor-tests' },
          { name: 'ADIUTOR TESTS', slug: 'adiutor-tests-north' },
          { name: ' adiutor tests ', slug: 'adiutor-tests-south' },
        ],
        withUrlName,
      ).map(({ label, slug }) => label.endsWith(`(${slug})`)),
    ).toEqual([true, true, true]);
  });

  it('keeps what else the caller gave for each company', () => {
    expect(
      companyChoiceLabels(
        [{ id: 'company-1', name: 'Adiutor Tests', slug: 'adiutor-tests' }],
        withUrlName,
      ),
    ).toEqual([
      { id: 'company-1', name: 'Adiutor Tests', slug: 'adiutor-tests', label: 'Adiutor Tests' },
    ]);
  });
});
