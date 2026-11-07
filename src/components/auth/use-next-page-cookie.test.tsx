/**
 * @file Tests for reading and removing the cookies that tell the next page
 * something: decoding, removal updating whatever shows them, and nothing
 * during server rendering.
 */
import { act, render, renderHook, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { clearNextPageCookie, useNextPageCookie } from './use-next-page-cookie';

/** The cookie the tests use. */
const NAME = 'adiutor-tests-notice';

/**
 * Shows a cookie's value, as a notice would.
 *
 * @param props - Component props.
 * @param props.name - The cookie's name.
 * @returns Its value, or nothing.
 */
function Shown({ name }: { name: string }) {
  const value = useNextPageCookie(name);
  return value === null ? null : <p>{value}</p>;
}

afterEach(() => {
  [NAME, 'adiutor-tests-other'].forEach((name) => {
    document.cookie = `${name}=; Max-Age=0; path=/`;
  });
});

describe('useNextPageCookie', () => {
  it('reads the decoded value of the cookie with that name', () => {
    document.cookie = 'adiutor-tests-other=github%3Aother; path=/';
    document.cookie = `${NAME}=github%3Amfa-off; path=/`;

    expect(renderHook(() => useNextPageCookie(NAME)).result.current).toBe('github:mfa-off');
  });

  it('reads nothing without the cookie, or with one that isn’t URL-encoded', () => {
    expect(renderHook(() => useNextPageCookie(NAME)).result.current).toBeNull();

    document.cookie = `${NAME}=%E0%A4%A; path=/`;
    expect(renderHook(() => useNextPageCookie(NAME)).result.current).toBeNull();
  });

  it('hides whatever shows the cookie once it is removed, and leaves other cookies alone', () => {
    document.cookie = `${NAME}=github; path=/`;
    document.cookie = 'adiutor-tests-other=google; path=/';
    render(
      <>
        <Shown name={NAME} />
        <Shown name={NAME} />
        <Shown name="adiutor-tests-other" />
      </>,
    );
    expect(screen.getAllByText('github')).toHaveLength(2);

    act(() => clearNextPageCookie(NAME));

    expect(screen.queryByText('github')).not.toBeInTheDocument();
    expect(document.cookie).not.toContain(`${NAME}=`);
    expect(screen.getByText('google')).toBeInTheDocument();
  });

  it('reads nothing during server rendering, so no page turns dynamic for it', () => {
    document.cookie = `${NAME}=github; path=/`;

    expect(renderToString(<Shown name={NAME} />)).toBe('');
  });
});
