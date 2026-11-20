/**
 * @file Tests for the avatar and the initials it shows.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Avatar, { initialsOf } from './avatar';

describe('initialsOf', () => {
  it('takes the first letters of the first two words of a name', () => {
    expect(initialsOf('Jane Doe')).toBe('JD');
    expect(initialsOf('ada king lovelace')).toBe('AK');
  });

  it('takes the first two letters of a single word', () => {
    expect(initialsOf('Adiutor')).toBe('AD');
    expect(initialsOf('x')).toBe('X');
  });

  it('uses the part of an email address before the @, split on dots, dashes and underscores', () => {
    expect(initialsOf('jane@adiutor.test')).toBe('JA');
    expect(initialsOf('jane.doe@adiutor.test')).toBe('JD');
    expect(initialsOf('mary-jane_doe@adiutor.test')).toBe('MJ');
  });

  it('treats a dotted name without an @ the same way', () => {
    expect(initialsOf('a.b')).toBe('AB');
  });

  it('gives a question mark when there is nothing to take letters from', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('@adiutor.test')).toBe('?');
  });
});

describe('Avatar', () => {
  it('shows the initials and is hidden from assistive technology', () => {
    const { container } = render(<Avatar name="Jane Doe" />);

    expect(container.firstElementChild).toHaveTextContent('JD');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).not.toHaveAttribute('title');
  });

  it('shows the name on hover when it stands without it', () => {
    const { container } = render(<Avatar name="Jane Doe" size="xs" title="Jane Doe" />);

    expect(container.firstElementChild).toHaveAttribute('title', 'Jane Doe');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
