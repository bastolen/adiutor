/**
 * @file Tests for the Email language field.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import EmailLanguageField from './email-language-field';

describe('EmailLanguageField', () => {
  it('starts on Default when the form offers it, naming the language it stands for', async () => {
    const user = userEvent.setup();
    renderInLocale('nl-NL', <EmailLanguageField purpose="account" defaultLocale="es-ES" />);

    const select = screen.getByRole('combobox', { name: 'Taal van de e-mail' });
    expect(select).toHaveTextContent('Standaard');
    await user.click(select);
    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(
      'Standaard Volgt de standaardtaal van Adiutor, nu Español.',
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
});
