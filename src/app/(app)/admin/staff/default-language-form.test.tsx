/**
 * @file Tests for the form that chooses Adiutor's default language.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { isLocale, type Locale } from '@/lib/i18n/locales';

import { saveDefaultLanguageAction } from './actions';
import DefaultLanguageForm from './default-language-form';
import renderInLocale from '../../../../../tests/i18n/render';

vi.mock('./actions', () => ({ saveDefaultLanguageAction: vi.fn() }));

afterEach(() => {
  vi.mocked(saveDefaultLanguageAction).mockReset();
});

describe('DefaultLanguageForm', () => {
  it('shows the current default, each language with its flag and named in itself', async () => {
    const user = userEvent.setup();
    renderInLocale('en-US', <DefaultLanguageForm defaultLocale="es-ES" />);

    const select = screen.getByRole('combobox', { name: 'Default language' });
    expect(select).toHaveTextContent('Español');
    expect(select.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await user.click(select);
    expect(screen.getByRole('option', { name: 'Nederlands' })).toBeInTheDocument();
  });

  it('saves the chosen language', async () => {
    vi.mocked(saveDefaultLanguageAction).mockResolvedValue({
      ok: true,
      message: 'Default language saved.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <DefaultLanguageForm defaultLocale="en-US" />);

    await user.click(screen.getByRole('combobox', { name: 'Default language' }));
    await user.click(screen.getByRole('option', { name: 'Nederlands' }));
    await user.click(screen.getByRole('button', { name: 'Save default language' }));

    await waitFor(() => expect(saveDefaultLanguageAction).toHaveBeenCalledTimes(1));
    const formData = defined(vi.mocked(saveDefaultLanguageAction).mock.calls[0], 'the call')[1];
    expect(formData.get('defaultLocale')).toBe('nl-NL');
  });

  it('shows the language just saved, not the one before', async () => {
    /** Shows a new default on the page, as the action's refresh does. */
    let showSaved: (locale: Locale) => void = () => {};
    /**
     * The staff page's card, re-rendered with the saved default.
     *
     * @returns The form.
     */
    function Card() {
      const [saved, setSaved] = useState<Locale>('en-US');
      showSaved = setSaved;
      return <DefaultLanguageForm defaultLocale={saved} />;
    }
    vi.mocked(saveDefaultLanguageAction).mockImplementation(async (_previous, formData) => {
      const chosen = formData.get('defaultLocale');
      if (isLocale(chosen)) {
        showSaved(chosen);
      }
      return { ok: true, message: 'Default language saved.' };
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <Card />);

    await user.click(screen.getByRole('combobox', { name: 'Default language' }));
    await user.click(screen.getByRole('option', { name: 'Nederlands' }));
    await user.click(screen.getByRole('button', { name: 'Save default language' }));

    expect(await screen.findByText('Default language saved.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Default language' })).toHaveTextContent(
      'Nederlands',
    );
  });

  it('speaks the reader’s language', () => {
    renderInLocale('nl-NL', <DefaultLanguageForm defaultLocale="nl-NL" />);

    expect(screen.getByRole('combobox', { name: 'Standaardtaal' })).toHaveTextContent('Nederlands');
    expect(screen.getByRole('button', { name: 'Standaardtaal opslaan' })).toBeInTheDocument();
  });
});
