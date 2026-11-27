/**
 * @file Tests for the Largest file form on Settings' Integrations tab:
 * the limit and its ceiling, saving it, and the locked field while the
 * server's environment chooses it.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../../tests/i18n/render';
import { saveLargestFileAction } from './actions';
import LargestFileForm from './largest-file-form';

vi.mock('./actions', () => ({ saveLargestFileAction: vi.fn() }));

afterEach(() => {
  vi.mocked(saveLargestFileAction).mockReset();
});

describe('LargestFileForm', () => {
  it('saves a number of megabytes up to the ceiling', async () => {
    vi.mocked(saveLargestFileAction).mockResolvedValue({
      ok: true,
      message: 'Largest file saved.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <LargestFileForm value={10} ceiling={4} locked={false} />);

    const field = screen.getByRole('spinbutton', { name: 'Megabytes' });
    expect(field).toHaveValue(10);
    expect(field).toHaveAttribute('max', '4');
    expect(field).toHaveAccessibleDescription('From 1 to 4.');
    await user.clear(field);
    await user.type(field, '3');
    await user.click(screen.getByRole('button', { name: 'Save size' }));

    await waitFor(() => expect(saveLargestFileAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveLargestFileAction).mock.calls[0], 'the call')[1];
    expect(formData.get('maxFileMb')).toBe('3');
  });

  it('only shows a limit the environment chooses, saying why', () => {
    renderInLocale('en-US', <LargestFileForm value={25} ceiling={50} locked />);

    const field = screen.getByRole('spinbutton', { name: 'Megabytes' });
    expect(field).toBeDisabled();
    expect(field).toHaveAccessibleDescription(
      "Chosen in the server's environment (ATTACHMENTS_MAX_FILE_MB), so it can't be changed here.",
    );
    expect(screen.queryByRole('button', { name: 'Save size' })).toBeNull();
  });
});
