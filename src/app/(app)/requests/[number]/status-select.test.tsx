/**
 * @file Tests for the staff's status select on a request's page.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { changeStatusAction } from './actions';
import StatusSelect from './status-select';

vi.mock('./actions', () => ({ changeStatusAction: vi.fn() }));

afterEach(() => {
  vi.mocked(changeStatusAction).mockReset();
});

/** The statuses, named for the staff. */
const OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting for the company' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

describe('StatusSelect', () => {
  it('shows the saved status and saves another one as soon as it is picked', async () => {
    vi.mocked(changeStatusAction).mockResolvedValue({ ok: true, message: 'Status saved.' });
    const user = userEvent.setup();
    render(<StatusSelect request={142} status="open" options={OPTIONS} />);

    const select = screen.getByRole('combobox', { name: 'Status' });
    expect(select).toHaveTextContent('Open');
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'To do' }));

    await waitFor(() => expect(changeStatusAction).toHaveBeenCalledTimes(1));
    expect(
      Object.fromEntries(defined(vi.mocked(changeStatusAction).mock.calls[0], 'the call')[1]),
    ).toEqual({ request: '142', status: 'todo', from: 'open' });
    // Not replaced, so keyboard focus stays where it was.
    expect(screen.getByRole('combobox', { name: 'Status' })).toBe(select);
    expect(select).toHaveFocus();
  });

  it('saves nothing when the status it has is picked again', async () => {
    const user = userEvent.setup();
    render(<StatusSelect request={142} status="open" options={OPTIONS} />);

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(screen.getByRole('option', { name: 'Open' }));

    expect(changeStatusAction).not.toHaveBeenCalled();
  });

  it('is busy while saving, without opening or losing focus', async () => {
    const user = userEvent.setup();
    /** Settles the change, which the test holds back until it has checked the busy state. */
    let finish: (result: { ok: true; message: string }) => void = () => {};
    vi.mocked(changeStatusAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<StatusSelect request={142} status="open" options={OPTIONS} />);

    const select = screen.getByRole('combobox', { name: 'Status' });
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Done' }));
    await waitFor(() => expect(select).toHaveAttribute('aria-busy', 'true'));
    expect(select).toHaveTextContent('Done');
    expect(select).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    finish({ ok: true, message: 'Request marked as done.' });
    await waitFor(() => expect(select).not.toHaveAttribute('aria-busy'));
  });

  it('shows a refusal and goes back to the saved status', async () => {
    vi.mocked(changeStatusAction).mockResolvedValue({
      ok: false,
      message: 'This company is deactivated. Reactivate it first.',
    });
    const user = userEvent.setup();
    render(<StatusSelect request={142} status="open" options={OPTIONS} />);

    const select = screen.getByRole('combobox', { name: 'Status' });
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Cancelled' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This company is deactivated.');
    expect(select).toHaveTextContent('Open');
  });

  it('shows the new status once the page has it', async () => {
    vi.mocked(changeStatusAction).mockResolvedValue({ ok: true, message: 'Status saved.' });
    const user = userEvent.setup();
    const { rerender } = render(<StatusSelect request={142} status="open" options={OPTIONS} />);

    const select = screen.getByRole('combobox', { name: 'Status' });
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'In progress' }));
    await waitFor(() => expect(changeStatusAction).toHaveBeenCalledTimes(1));
    // The action's refresh gives the page the saved status.
    rerender(<StatusSelect request={142} status="in_progress" options={OPTIONS} />);

    await waitFor(() => expect(select).not.toHaveAttribute('aria-busy'));
    expect(select).toHaveTextContent('In progress');
  });
});
