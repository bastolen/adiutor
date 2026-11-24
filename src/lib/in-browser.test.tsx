/**
 * @file Tests for the helpers of values only the browser knows: the
 * subscription to nothing, and whether the page has hydrated.
 */
import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import useInBrowser, { noSubscription } from './in-browser';

/**
 * Shows whether it runs in the browser.
 *
 * @returns `browser` or `server`.
 */
function WhereItRuns() {
  return <span>{useInBrowser() ? 'browser' : 'server'}</span>;
}

describe('useInBrowser', () => {
  it('is false on the server, so the page it renders matches the first render in the browser', () => {
    expect(renderToString(<WhereItRuns />)).toContain('server');
  });

  it('is true once the page runs in the browser', () => {
    render(<WhereItRuns />);

    expect(screen.getByText('browser')).toBeInTheDocument();
  });
});

describe('noSubscription', () => {
  it('subscribes to nothing, and unsubscribing does nothing', () => {
    const unsubscribe = noSubscription();

    expect(unsubscribe()).toBeUndefined();
  });
});
