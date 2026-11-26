/**
 * @file Tests for the note on a setting the server's environment chooses:
 * it names the variable, above what was chosen, and gives the same sentence
 * for a locked field.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../tests/i18n/render';
import SetByEnvironment, { useSetByEnvironment } from './set-by-environment';
import TextField from './text-field';

/**
 * A locked field described by the sentence.
 *
 * @returns The field.
 */
function LockedField() {
  const setByEnvironment = useSetByEnvironment();
  return <TextField label="Megabytes" disabled description={setByEnvironment('ADIUTOR_X')} />;
}

describe('SetByEnvironment', () => {
  it('says the environment chose it, naming the variable, above what was chosen', () => {
    render(
      <SetByEnvironment variable="ATTACHMENTS_STORAGE">
        <p>A folder on this server</p>
      </SetByEnvironment>,
    );
    expect(
      screen.getByText(
        "Chosen in the server's environment (ATTACHMENTS_STORAGE), so it can't be changed here.",
      ),
    ).toBeVisible();
    expect(screen.getByText('A folder on this server')).toBeVisible();
  });

  it('gives the sentence in the reader’s language, for a locked field', () => {
    renderInLocale('nl-NL', <LockedField />);
    expect(screen.getByRole('textbox', { name: 'Megabytes' })).toHaveAccessibleDescription(
      'Gekozen in de omgeving van de server (ADIUTOR_X), dus je kunt het hier niet wijzigen.',
    );
  });
});
