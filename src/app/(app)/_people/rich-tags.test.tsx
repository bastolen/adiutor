/**
 * @file Tests for the renderers of the rich message tags that several pages
 * share, here the link to a user's page.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { hiddenTag, userLink } from './rich-tags';

describe('userLink', () => {
  it('makes the tag a link to the user in the admin area', () => {
    const link = userLink('user-1');

    render(<p>Signed in as {link('Ada')}.</p>);

    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/admin/users/user-1',
    );
  });
});

describe('hiddenTag', () => {
  it('keeps the text for screen readers only', () => {
    render(<p>{hiddenTag('Last active:')}</p>);

    expect(screen.getByText('Last active:')).toHaveClass('sr-only');
  });
});
