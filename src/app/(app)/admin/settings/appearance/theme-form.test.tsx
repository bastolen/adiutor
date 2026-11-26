/**
 * @file Tests for the light and dark mode form: the saved choice checked,
 * each choice saying what it means, and saving the one chosen.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import { saveForcedThemeAction } from './actions';
import ThemeForm from './theme-form';

vi.mock('./actions', () => ({
  default: vi.fn(),
  saveForcedThemeAction: vi.fn(),
  uploadBrandImageAction: vi.fn(),
  removeBrandImageAction: vi.fn(),
}));

afterEach(() => {
  vi.mocked(saveForcedThemeAction).mockReset();
});

describe('ThemeForm', () => {
  it('checks both modes while nothing is kept, each choice saying what it means', () => {
    render(<ThemeForm saved={null} />);

    expect(screen.getByRole('group', { name: 'Show pages in' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Light and dark mode/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Light mode only/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^Dark mode only/ })).not.toBeChecked();
    expect(
      screen.getByText(
        'Every page is dark, whatever the device prefers, and there’s nothing to choose.',
      ),
    ).toBeInTheDocument();
  });

  it('checks the mode every page is kept in', () => {
    render(<ThemeForm saved="dark" />);

    expect(screen.getByRole('radio', { name: /^Dark mode only/ })).toBeChecked();
  });

  it('saves the choice', async () => {
    vi.mocked(saveForcedThemeAction).mockResolvedValue({
      ok: true,
      message: 'Light and dark mode saved.',
    });
    const user = userEvent.setup();
    render(<ThemeForm saved={null} />);

    await user.click(screen.getByRole('radio', { name: /^Light mode only/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveForcedThemeAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveForcedThemeAction).mock.calls[0], 'the call')[1];
    expect(formData.get('theme')).toBe('light');
    expect(screen.getByRole('radio', { name: /^Light mode only/ })).toBeChecked();
  });
});
