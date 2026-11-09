/**
 * @file Tests for the language flags.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/locales';

import LanguageFlag from './language-flag';

describe('LanguageFlag', () => {
  it.each(LOCALES)('draws a flag for %s, hidden from screen readers', (locale) => {
    const { container } = render(<LanguageFlag locale={locale} />);

    const flag = container.querySelector('svg');
    expect(flag).toHaveAttribute('aria-hidden', 'true');
    expect(flag?.querySelectorAll('rect').length).toBeGreaterThan(1);
  });

  it('draws the 50 stars of the US flag', () => {
    const { container } = render(<LanguageFlag locale="en-US" />);

    expect(container.querySelectorAll('circle')).toHaveLength(50);
  });
});
