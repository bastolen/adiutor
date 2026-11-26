/**
 * @file Tests for the Attaching files form on Settings' Connections tab:
 * turning "People can attach files" on and off, and the box that can't be
 * changed without a storage or while the server's environment turned
 * attachments off.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../../tests/i18n/render';
import { saveAttachingAction } from './actions';
import AttachingForm from './attaching-form';

vi.mock('./actions', () => ({ saveAttachingAction: vi.fn() }));

afterEach(() => {
  vi.mocked(saveAttachingAction).mockReset();
});

/**
 * What the action was sent, the last time it ran.
 *
 * @returns The form's fields.
 */
const sent = () => defined(vi.mocked(saveAttachingAction).mock.calls.at(-1), 'the last call')[1];

describe('AttachingForm', () => {
  it('turns attaching on, and keeps the box as it was saved', async () => {
    vi.mocked(saveAttachingAction).mockResolvedValue({
      ok: true,
      message: 'People can attach files now.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <AttachingForm on={false} storageChosen offByEnvironment={false} />);

    const box = screen.getByRole('checkbox', { name: 'People can attach files' });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveAttachingAction).toHaveBeenCalledTimes(1));
    expect(sent().get('enabled')).toBe('on');
    expect(await screen.findByText('People can attach files now.')).toBeInTheDocument();
    expect(box).toBeChecked();
  });

  it('turns attaching off by sending the box unticked', async () => {
    vi.mocked(saveAttachingAction).mockResolvedValue({
      ok: true,
      message: 'Attaching files is turned off.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <AttachingForm on storageChosen offByEnvironment={false} />);

    await user.click(screen.getByRole('checkbox', { name: 'People can attach files' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveAttachingAction).toHaveBeenCalledTimes(1));
    expect(sent().get('enabled')).toBeNull();
  });

  it('can’t be turned on without a storage, and says to choose one first', () => {
    renderInLocale(
      'en-US',
      <AttachingForm on={false} storageChosen={false} offByEnvironment={false} />,
    );

    const box = screen.getByRole('checkbox', { name: 'People can attach files' });
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription('Choose where files are kept first.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('is off and can’t be changed while the environment turned attachments off', () => {
    renderInLocale('en-US', <AttachingForm on storageChosen={false} offByEnvironment />);

    const box = screen.getByRole('checkbox', { name: 'People can attach files' });
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
    expect(box).toHaveAccessibleDescription(
      "Chosen in the server's environment (ATTACHMENTS_STORAGE), so it can't be changed here.",
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
