/**
 * @file Tests for the brand colours form: the saved colours in the fields
 * and the preview, the preview following what's typed (and saying when the
 * accent was adjusted), going back to Adiutor's colours, and saving.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NO_BRAND_COLOURS, THEME_PALETTE } from '@/lib/branding';
import { defined } from '@/lib/defined';

import saveBrandColoursAction from './actions';
import ColoursForm from './colours-form';

vi.mock('./actions', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(saveBrandColoursAction).mockReset();
});

/**
 * Reads a custom property a preview panel sets.
 *
 * @param mode - The panel.
 * @param property - The property, e.g. `--primary`.
 * @returns Its value.
 */
function previewed(mode: 'light' | 'dark', property: string): string {
  return screen.getByTestId(`preview-${mode}`).style.getPropertyValue(property);
}

describe('ColoursForm', () => {
  it('shows the saved colours in the fields and the preview', () => {
    render(<ColoursForm saved={{ accent: '#c2185b', accentDark: '#ff80ab', tint: null }} />);

    expect(screen.getByRole('textbox', { name: 'Accent' })).toHaveValue('#c2185b');
    expect(screen.getByRole('textbox', { name: 'Accent in dark mode' })).toHaveValue('#ff80ab');
    expect(screen.getByRole('textbox', { name: 'Tint' })).toHaveValue('');
    expect(previewed('light', '--primary')).toBe('#c2185b');
    expect(previewed('dark', '--primary')).toBe('#ff80ab');
    expect(previewed('light', '--surface')).toBe(THEME_PALETTE.light.surface);
  });

  it('previews what’s typed, and says when the accent had to be made darker', async () => {
    const user = userEvent.setup();
    render(<ColoursForm saved={NO_BRAND_COLOURS} />);
    expect(previewed('light', '--primary')).toBe(THEME_PALETTE.light.primary);

    await user.type(screen.getByRole('textbox', { name: 'Accent' }), 'FFD400');

    expect(previewed('dark', '--primary')).toBe('#ffd400');
    const light = previewed('light', '--primary');
    expect(light).not.toBe('#ffd400');
    expect(
      screen.getByText(`Made darker so text on it stays readable: ${light}.`),
    ).toBeInTheDocument();
  });

  it('empties the fields for Adiutor’s colours, and saves them like any change', async () => {
    vi.mocked(saveBrandColoursAction).mockResolvedValue({ ok: true, message: 'Colours saved.' });
    const user = userEvent.setup();
    render(<ColoursForm saved={{ accent: '#c2185b', accentDark: null, tint: '#2e7d32' }} />);

    await user.click(screen.getByRole('button', { name: 'Use Adiutor’s colours' }));
    expect(screen.getByRole('textbox', { name: 'Accent' })).toHaveValue('');
    expect(previewed('light', '--primary')).toBe(THEME_PALETTE.light.primary);
    await user.click(screen.getByRole('button', { name: 'Save colours' }));

    await waitFor(() => expect(saveBrandColoursAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveBrandColoursAction).mock.calls[0], 'the call')[1];
    expect([formData.get('accent'), formData.get('accentDark'), formData.get('tint')]).toEqual([
      '',
      '',
      '',
    ]);
    expect(await screen.findByText('Colours saved.')).toBeInTheDocument();
  });

  it('shows the colours as saved once they change', () => {
    const { rerender } = render(<ColoursForm saved={NO_BRAND_COLOURS} />);

    rerender(<ColoursForm saved={{ accent: '#c2185b', accentDark: null, tint: null }} />);

    expect(screen.getByRole('textbox', { name: 'Accent' })).toHaveValue('#c2185b');
  });
});
