/**
 * @file Tests for the password dialog: it shows a wrong password in the
 * dialog, starts afresh each time it opens (no old error or password), and
 * reports a change that worked.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PasswordActionDialog from './password-action-dialog';

/** The mocked change and router. */
const { action, onDone, push } = vi.hoisted(() => ({
  action: vi.fn(),
  onDone: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router.
   *
   * @returns A router whose `push` is recorded.
   */
  useRouter: () => ({ push }),
}));

/**
 * A card with a button that opens the dialog, as the Security page has.
 *
 * @returns The harness.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Turn off
      </button>
      <PasswordActionDialog
        open={open}
        onOpenChange={setOpen}
        title="Turn off two-step verification?"
        description="Signing in will only need your password."
        confirmLabel="Turn off two-step verification"
        hasPassword
        action={action}
        onDone={onDone}
      />
    </>
  );
}

describe('PasswordActionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts afresh when reopened after a wrong password', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ error: { code: 'INVALID_PASSWORD' } });
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByLabelText('Current password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is incorrect.');
    expect(action).toHaveBeenCalledWith('wrong-password');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('reports a change that worked', async () => {
    const user = userEvent.setup();
    action.mockResolvedValue({ error: null });
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByLabelText('Current password'), 'right-password');
    await user.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(action).toHaveBeenCalledWith('right-password');
  });
});
