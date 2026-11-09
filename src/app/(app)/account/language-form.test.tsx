/**
 * @file Tests for the account's language form.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveLanguageAction } from './actions';
import LanguageForm from './language-form';
import renderInLocale from '../../../../tests/i18n/render';

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
  it('shows the current language, each named in itself', async () => {
    const user = userEvent.setup();
    renderInLocale('nl-NL', <LanguageForm />);

    const select = screen.getByRole('combobox', { name: 'Taal' });
    expect(select).toHaveTextContent('Nederlands');
    await user.click(select);
    expect(screen.getByRole('option', { name: 'English (US)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
  });

  it('reloads the page where the action says once the language is saved', async () => {
    vi.mocked(saveLanguageAction).mockResolvedValue({ ok: true, data: SAVED_PATH });
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const user = userEvent.setup();
    renderInLocale('en-US', <LanguageForm />);

    await user.click(screen.getByRole('button', { name: 'Save language' }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(replaceState).toHaveBeenCalledWith(window.history.state, '', SAVED_PATH);
  });

  it('reloads the page also when it is already at that address, after an earlier change', async () => {
    // Going to the same address with a `#section` only scrolls, which left the button busy.
    window.history.replaceState(null, '', SAVED_PATH);
    vi.mocked(saveLanguageAction).mockResolvedValue({ ok: true, data: SAVED_PATH });
    const user = userEvent.setup();
    renderInLocale('es-ES', <LanguageForm />);

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
    renderInLocale('en-US', <LanguageForm />);

    await user.click(screen.getByRole('button', { name: 'Save language' }));

    expect(await screen.findByText('Choose one of the languages.')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save language' })).toBeEnabled();
  });
});
