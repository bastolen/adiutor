/**
 * @file Tests for the account's language form.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';

import renderInLocale from '../../../../tests/i18n/render';
import { saveLanguageAction } from './actions';
import LanguageForm from './language-form';

vi.mock('./actions', () => ({ saveLanguageAction: vi.fn() }));

/** Where the action sends the page once the language is saved. */
const SAVED_PATH = '/account?language=saved#language';

/** Stands in for `window.location.reload`, which jsdom can't do. */
const reload = vi.fn();

/** Stands in for `window.location.assign`, to show it isn't used. */
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, assign, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockClear();
  assign.mockClear();
  vi.mocked(saveLanguageAction).mockReset();
  window.history.replaceState(null, '', '/');
});

describe('LanguageForm', () => {
  it('turns the select and the button off while a staff member is signed in as the user', () => {
    renderInLocale(
      'en-US',
      <>
        <LanguageForm choice="en-US" defaultLocale="en-US" />
        <SignedInAsMarker />
      </>,
    );

    // The attribute itself, not only the fieldset's, so the select's menu stays shut too.
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveAttribute('disabled');
    expect(screen.getByRole('button', { name: 'Save language' })).toHaveAttribute('disabled');
  });

  it('shows the saved language, Default first and each language named in itself', async () => {
    const user = userEvent.setup();
    renderInLocale('nl-NL', <LanguageForm choice="nl-NL" defaultLocale="en-US" />);

    const select = screen.getByRole('combobox', { name: 'Taal' });
    expect(select).toHaveTextContent('Nederlands');
    await user.click(select);
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAccessibleName(
      'Standaard Volgt de standaardtaal van Adiutor, nu English (US).',
    );
    expect(screen.getByRole('option', { name: 'English (US)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
  });

  it('starts on Default for an account that follows Adiutor’s default language', () => {
    renderInLocale('en-US', <LanguageForm choice="default" defaultLocale="es-ES" />);

    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('Default');
  });

  it('sends Default as the choice when it is picked', async () => {
    vi.mocked(saveLanguageAction).mockResolvedValue({ ok: true, data: SAVED_PATH });
    const user = userEvent.setup();
    renderInLocale('en-US', <LanguageForm choice="nl-NL" defaultLocale="en-US" />);

    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    await user.click(screen.getByRole('option', { name: /^Default/ }));
    await user.click(screen.getByRole('button', { name: 'Save language' }));

    await waitFor(() => expect(saveLanguageAction).toHaveBeenCalledOnce());
    const formData = vi.mocked(saveLanguageAction).mock.calls[0]?.[1];
    expect(formData?.get('locale')).toBe('default');
  });

  it('reloads the page where the action says once the language is saved', async () => {
    vi.mocked(saveLanguageAction).mockResolvedValue({ ok: true, data: SAVED_PATH });
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const user = userEvent.setup();
    renderInLocale('en-US', <LanguageForm choice="en-US" defaultLocale="en-US" />);

    await user.click(screen.getByRole('button', { name: 'Save language' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', SAVED_PATH);
  });

  it('reloads the page also when it is already at that address, after an earlier change', async () => {
    // Going to the same address with a `#section` only scrolls, which left the button busy.
    window.history.replaceState(null, '', SAVED_PATH);
    vi.mocked(saveLanguageAction).mockResolvedValue({ ok: true, data: SAVED_PATH });
    const user = userEvent.setup();
    renderInLocale('es-ES', <LanguageForm choice="es-ES" defaultLocale="en-US" />);

    await user.click(screen.getByRole('button', { name: 'Guardar idioma' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows why saving failed, and stays', async () => {
    vi.mocked(saveLanguageAction).mockResolvedValue({
      ok: false,
      message: 'Choose one of the languages.',
    });
    const user = userEvent.setup();
    renderInLocale('en-US', <LanguageForm choice="default" defaultLocale="en-US" />);

    await user.click(screen.getByRole('button', { name: 'Save language' }));

    expect(await screen.findByText('Choose one of the languages.')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save language' })).toBeEnabled();
  });
});
