/**
 * @file Tests for the brand colours form: Adiutor's own colours in the
 * fields while none are saved, the saved colours in the fields and the
 * preview, the dark accent following the accent until it's changed, a dark
 * accent on its own, the preview following what's typed (and saying when
 * the accent was adjusted), going back to Adiutor's colours, and saving.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADIUTOR_COLOURS, NO_BRAND_COLOURS, THEME_PALETTE } from '@/lib/branding';
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

/**
 * Finds one of the form's colour fields.
 *
 * @param name - The field's label.
 * @returns The field.
 */
function field(name: 'Accent' | 'Accent in dark mode' | 'Tint'): HTMLElement {
  return screen.getByRole('textbox', { name });
}

/**
 * Saves the form and returns what it sent.
 *
 * @param user - The user typing and clicking.
 * @returns The accent, the dark accent and the tint the form sent.
 */
async function saveAndRead(user: ReturnType<typeof userEvent.setup>): Promise<unknown[]> {
  await user.click(screen.getByRole('button', { name: 'Save colours' }));
  await waitFor(() => expect(saveBrandColoursAction).toHaveBeenCalledTimes(1));
  const formData = defined(vi.mocked(saveBrandColoursAction).mock.calls[0], 'the call')[1];
  return [formData.get('accent'), formData.get('accentDark'), formData.get('tint')];
}

describe('ColoursForm', () => {
  it('shows Adiutor’s own colours while none are saved, and previews the theme itself', () => {
    render(<ColoursForm saved={NO_BRAND_COLOURS} />);

    expect(field('Accent')).toHaveValue(ADIUTOR_COLOURS.accent);
    expect(field('Accent in dark mode')).toHaveValue(ADIUTOR_COLOURS.accentDark);
    expect(field('Tint')).toHaveValue(ADIUTOR_COLOURS.tint);
    expect(previewed('light', '--primary')).toBe(THEME_PALETTE.light.primary);
    expect(previewed('dark', '--primary')).toBe(THEME_PALETTE.dark.primary);
    expect(previewed('light', '--surface')).toBe(THEME_PALETTE.light.surface);
  });

  it('shows the saved colours in the fields and the preview', () => {
    render(<ColoursForm saved={{ accent: '#c2185b', accentDark: '#ff80ab', tint: null }} />);

    expect(field('Accent')).toHaveValue('#c2185b');
    expect(field('Accent in dark mode')).toHaveValue('#ff80ab');
    expect(field('Tint')).toHaveValue(ADIUTOR_COLOURS.tint);
    expect(previewed('light', '--primary')).toBe('#c2185b');
    expect(previewed('dark', '--primary')).toBe('#ff80ab');
    expect(previewed('light', '--surface')).toBe(THEME_PALETTE.light.surface);
  });

  it('lets the dark accent follow the accent as it’s typed, until it’s changed', async () => {
    const user = userEvent.setup();
    render(<ColoursForm saved={NO_BRAND_COLOURS} />);

    await user.clear(field('Accent'));
    await user.type(field('Accent'), 'C2185B');
    expect(field('Accent in dark mode')).toHaveValue('#c2185b');

    await user.clear(field('Accent in dark mode'));
    await user.type(field('Accent in dark mode'), '#ff80ab');
    await user.clear(field('Accent'));
    await user.type(field('Accent'), '#1d63dc');
    expect(field('Accent in dark mode')).toHaveValue('#ff80ab');
  });

  it('previews a dark accent on its own in dark mode only, and sends what the fields show', async () => {
    vi.mocked(saveBrandColoursAction).mockResolvedValue({ ok: true, message: 'Colours saved.' });
    const user = userEvent.setup();
    render(<ColoursForm saved={NO_BRAND_COLOURS} />);

    await user.clear(field('Accent in dark mode'));
    await user.type(field('Accent in dark mode'), '#ff80ab');

    expect(previewed('light', '--primary')).toBe(THEME_PALETTE.light.primary);
    expect(previewed('dark', '--primary')).toBe('#ff80ab');
    expect(await saveAndRead(user)).toEqual([
      ADIUTOR_COLOURS.accent,
      '#ff80ab',
      ADIUTOR_COLOURS.tint,
    ]);
    expect(await screen.findByText('Colours saved.')).toBeInTheDocument();
  });

  it('previews what’s typed, and says when the accent had to be made darker', async () => {
    const user = userEvent.setup();
    render(<ColoursForm saved={NO_BRAND_COLOURS} />);

    await user.clear(field('Accent'));
    await user.type(field('Accent'), 'FFD400');

    expect(previewed('dark', '--primary')).toBe('#ffd400');
    const light = previewed('light', '--primary');
    expect(light).not.toBe('#ffd400');
    expect(
      screen.getByText(`Made darker so text on it stays readable: ${light}.`),
    ).toBeInTheDocument();
  });

  it('puts Adiutor’s colours back in the fields, following again, and saves them like any change', async () => {
    vi.mocked(saveBrandColoursAction).mockResolvedValue({ ok: true, message: 'Colours saved.' });
    const user = userEvent.setup();
    render(<ColoursForm saved={{ accent: '#c2185b', accentDark: '#ff80ab', tint: '#2e7d32' }} />);

    await user.click(screen.getByRole('button', { name: 'Use Adiutor’s colours' }));

    expect(field('Accent')).toHaveValue(ADIUTOR_COLOURS.accent);
    expect(field('Accent in dark mode')).toHaveValue(ADIUTOR_COLOURS.accentDark);
    expect(field('Tint')).toHaveValue(ADIUTOR_COLOURS.tint);
    expect(previewed('light', '--primary')).toBe(THEME_PALETTE.light.primary);
    expect(previewed('dark', '--primary')).toBe(THEME_PALETTE.dark.primary);
    expect(await saveAndRead(user)).toEqual([
      ADIUTOR_COLOURS.accent,
      ADIUTOR_COLOURS.accentDark,
      ADIUTOR_COLOURS.tint,
    ]);
    expect(await screen.findByText('Colours saved.')).toBeInTheDocument();
  });

  it('lets a dark accent stored as none follow the accent again, though the saved colours stay', async () => {
    vi.mocked(saveBrandColoursAction).mockResolvedValue({ ok: true, message: 'Colours saved.' });
    const user = userEvent.setup();
    render(<ColoursForm saved={{ accent: '#c2185b', accentDark: null, tint: null }} />);

    // The accent typed again as the dark accent: stored as none, so nothing saved changes.
    await user.clear(field('Accent in dark mode'));
    await user.type(field('Accent in dark mode'), '#c2185b');
    expect(await saveAndRead(user)).toEqual(['#c2185b', '#c2185b', ADIUTOR_COLOURS.tint]);
    await screen.findByText('Colours saved.');
    await user.clear(field('Accent'));
    await user.type(field('Accent'), '#1d63dc');

    expect(field('Accent in dark mode')).toHaveValue('#1d63dc');
  });

  it('shows the colours as saved once they change, the dark accent following again', () => {
    const { rerender } = render(
      <ColoursForm saved={{ accent: '#c2185b', accentDark: '#ff80ab', tint: null }} />,
    );

    rerender(<ColoursForm saved={{ accent: '#1d63dc', accentDark: null, tint: null }} />);

    expect(field('Accent')).toHaveValue('#1d63dc');
    expect(field('Accent in dark mode')).toHaveValue('#1d63dc');
  });

  describe('while a staff Admin keeps every page in one mode', () => {
    it('in light mode, hides the dark accent but still sends it as saved, and previews light only', async () => {
      const user = userEvent.setup();
      render(
        <ColoursForm
          saved={{ accent: '#c2185b', accentDark: '#ff80ab', tint: null }}
          forced="light"
        />,
      );

      expect(
        screen.queryByRole('textbox', { name: 'Accent in dark mode' }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('preview-light')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-dark')).not.toBeInTheDocument();

      await user.clear(field('Accent'));
      await user.type(field('Accent'), '#2e7d32');
      expect(await saveAndRead(user)).toEqual(['#2e7d32', '#ff80ab', ADIUTOR_COLOURS.tint]);
    });

    it('in dark mode, keeps both accents, says the accent is for emails and the icon, and previews dark only', () => {
      render(<ColoursForm saved={NO_BRAND_COLOURS} forced="dark" />);

      expect(field('Accent in dark mode')).toBeInTheDocument();
      expect(
        screen.getByText('The emails and the browser tab icon, which stay light.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('preview-dark')).toBeInTheDocument();
      expect(screen.queryByTestId('preview-light')).not.toBeInTheDocument();
    });
  });
});
