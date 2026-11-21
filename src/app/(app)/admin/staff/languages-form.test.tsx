/**
 * @file Tests for the staff page's Languages form: a checkbox per language,
 * the default always on, and the default select offering only the languages
 * that are on.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';
import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../tests/i18n/render';
import { saveLanguagesAction } from './actions';
import LanguagesForm from './languages-form';

vi.mock('./actions', () => ({ saveLanguagesAction: vi.fn() }));

afterEach(() => {
  vi.mocked(saveLanguagesAction).mockReset();
});

describe('LanguagesForm', () => {
  it('shows each language in itself, the default checked, always on and saying why', () => {
    renderInLocale('en-US', <LanguagesForm defaultLocale="nl-NL" offered={['en-US', 'nl-NL']} />);

    expect(screen.getByRole('checkbox', { name: 'English (US)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Español' })).not.toBeChecked();
    const dutch = screen.getByRole('checkbox', { name: 'Nederlands' });
    expect(dutch).toBeChecked();
    expect(dutch).toBeDisabled();
    expect(dutch).toHaveAccessibleDescription("Always on: it's the default language.");
    expect(screen.getByText('Español')).toHaveAttribute('lang', 'es-ES');
  });

  it('offers only the languages that are on as the default, and moves "always on" with it', async () => {
    const user = userEvent.setup();
    renderInLocale('en-US', <LanguagesForm defaultLocale="en-US" offered={['en-US']} />);

    const select = screen.getByRole('combobox', { name: 'Default language' });
    await user.click(select);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'English (US)',
    ]);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('checkbox', { name: 'Español' }));
    await user.click(select);
    await user.click(screen.getByRole('option', { name: 'Español' }));

    expect(screen.getByRole('checkbox', { name: 'Español' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'English (US)' })).toBeEnabled();
  });

  it('sends the default and the languages that are on', async () => {
    vi.mocked(saveLanguagesAction).mockResolvedValue({ ok: true, message: 'Languages saved.' });
    const user = userEvent.setup();
    renderInLocale('en-US', <LanguagesForm defaultLocale="en-US" offered={['en-US', 'nl-NL']} />);

    await user.click(screen.getByRole('checkbox', { name: 'Nederlands' }));
    await user.click(screen.getByRole('checkbox', { name: 'Español' }));
    await user.click(screen.getByRole('button', { name: 'Save languages' }));

    await waitFor(() => expect(saveLanguagesAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveLanguagesAction).mock.calls[0], 'the call')[1];
    expect(formData.get('defaultLocale')).toBe('en-US');
    // The default's checkbox is off, so it isn't sent: the service adds it.
    expect(formData.getAll('offered')).toEqual(['es-ES']);
  });

  it('turns everything off while a staff member is signed in as the user', () => {
    renderInLocale(
      'en-US',
      <>
        <LanguagesForm defaultLocale="en-US" offered={['en-US', 'nl-NL']} />
        <SignedInAsMarker />
      </>,
    );

    expect(screen.getByRole('checkbox', { name: 'Nederlands' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save languages' })).toBeDisabled();
  });

  it('reads in the page’s language', () => {
    renderInLocale('nl-NL', <LanguagesForm defaultLocale="nl-NL" offered={['nl-NL']} />);

    expect(screen.getByRole('group', { name: 'Aangeboden talen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talen opslaan' })).toBeInTheDocument();
  });
});
