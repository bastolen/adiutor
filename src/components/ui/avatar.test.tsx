/**
 * @file Tests for the avatar and the initials it shows.
 */
import { fireEvent, render } from '@testing-library/react';
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

  it('draws a picture over the initials, which stay for when it can’t load', () => {
    const { container } = render(<Avatar name="Jane Doe" src="/avatars/1?v=1" />);

    const picture = container.querySelector('img');
    expect(picture).toHaveAttribute('src', '/avatars/1?v=1');
    expect(picture).toHaveAttribute('alt', '');
    expect(container.firstElementChild).toHaveTextContent('JD');
  });

  it('shows the initials once the picture fails to load', () => {
    const { container } = render(<Avatar name="Jane Doe" src="/avatars/1?v=1" />);

    fireEvent.error(container.querySelector('img') ?? document.body);

    expect(container.querySelector('img')).toBeNull();
    expect(container.firstElementChild).toHaveTextContent('JD');
  });

  it('tries a new picture again after an earlier one failed', () => {
    const { container, rerender } = render(<Avatar name="Jane Doe" src="/avatars/1?v=1" />);
    fireEvent.error(container.querySelector('img') ?? document.body);

    rerender(<Avatar name="Jane Doe" src="/avatars/1?v=2" />);

    expect(container.querySelector('img')).toHaveAttribute('src', '/avatars/1?v=2');
  });

  it('draws no picture without one', () => {
    const { container } = render(<Avatar name="Jane Doe" src={null} />);

    expect(container.querySelector('img')).toBeNull();
  });
});
