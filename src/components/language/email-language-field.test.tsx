/**
 * @file Tests for the Email language field.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import EmailLanguageField from './email-language-field';
import { OfferedLanguagesProvider } from './offered-languages';

describe('EmailLanguageField', () => {
  it('starts on Default when the form offers it, naming the language it stands for', async () => {
    const user = userEvent.setup();
    renderInLocale('nl-NL', <EmailLanguageField purpose="account" defaultLocale="es-ES" />);

    const select = screen.getByRole('combobox', { name: 'Taal van de e-mail' });
    expect(select).toHaveTextContent('Standaard');
    await user.click(select);
    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(
      'Standaard Volgt de standaardtaal, nu Español.',
    );
  });

  it('starts on the sender’s own language without Default, as on the invite form', async () => {
    const user = userEvent.setup();
    renderInLocale('es-ES', <EmailLanguageField purpose="invitation" />);

    const select = screen.getByRole('combobox', { name: 'Idioma del correo' });
    expect(select).toHaveTextContent('Español');
    await user.click(select);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'English (US)',
      'Nederlands',
      'Español',
    ]);
  });

  it('names each language in itself, marked with its language for screen readers', async () => {
    const user = userEvent.setup();
    renderInLocale('en-US', <EmailLanguageField purpose="account" defaultLocale="en-US" />);

    await user.click(screen.getByRole('combobox', { name: 'Email language' }));

    expect(screen.getByText('Nederlands')).toHaveAttribute('lang', 'nl-NL');
    expect(screen.getByText('Español')).toHaveAttribute('lang', 'es-ES');
    // Default is worded in the page's language.
    expect(screen.getAllByRole('option')[0]?.querySelector('[lang]')).toBeNull();
  });

  it('offers only the languages that are on, and goes with just one left', async () => {
    const user = userEvent.setup();
    const { unmount } = renderInLocale(
      'en-US',
      <OfferedLanguagesProvider offered={['en-US', 'es-ES']}>
        <EmailLanguageField purpose="invitation" />
      </OfferedLanguagesProvider>,
    );
    await user.click(screen.getByRole('combobox', { name: 'Email language' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'English (US)',
      'Español',
    ]);

    unmount();
    renderInLocale(
      'en-US',
      <OfferedLanguagesProvider offered={['en-US']}>
        <EmailLanguageField purpose="invitation" />
      </OfferedLanguagesProvider>,
    );
    expect(screen.queryByRole('combobox', { name: 'Email language' })).not.toBeInTheDocument();
  });
});
