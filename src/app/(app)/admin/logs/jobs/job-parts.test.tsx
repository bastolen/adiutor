/**
 * @file Tests for what the Jobs page says a run did: its counts, "Nothing to
 * do" for a run that succeeded without any, and nothing for a failed run
 * without any, whose error says what happened.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RunSummary } from './job-parts';

// The Pause button in the same file uses the page's server actions, which only load on the server.
vi.mock('./actions', () => ({ pauseJobAction: vi.fn(), resumeJobAction: vi.fn() }));

describe('RunSummary', () => {
  it('lists the counts that aren’t zero, whether the run succeeded or not', () => {
    render(<RunSummary summary={{ sent: 3, failed: 1, skipped: 0 }} status="failed" />);

    expect(screen.getByText('3 sent')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.queryByText(/skipped/)).not.toBeInTheDocument();
  });

  it('says "Nothing to do" only for a run that succeeded', () => {
    const { container, rerender } = render(<RunSummary summary={{}} status="succeeded" />);
    expect(screen.getByText('Nothing to do')).toBeInTheDocument();

    rerender(<RunSummary summary={{}} status="failed" />);
    expect(container).toBeEmptyDOMElement();
  });
});
