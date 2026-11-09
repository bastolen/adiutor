/**
 * @file Integration tests for the language the guards' refusals are worded
 * in, with Adiutor's default language from the database.
 */
import { describe, expect, it } from 'vitest';

import { noteRefusalLocale, refusalBody } from './refusal-messages';
import { createStaffSettings, setupTestContext } from '../../../../tests/integration/helpers';

const { db } = setupTestContext();

describe('noteRefusalLocale', () => {
  it("words refusals in Adiutor's default language for a browser that chose none", async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const request = { headers: new Headers({ 'accept-language': 'nl-NL' }) };

    await noteRefusalLocale(request, db);

    expect(refusalBody(request, 'TWO_FACTOR_ALREADY_OFF').message).toBe(
      'La verificación en dos pasos ya está desactivada. No se ha cambiado nada.',
    );
  });

  it('keeps the language the browser chose', async () => {
    await createStaffSettings(db, 'Adiutor Tests', 'es-ES');
    const request = { headers: new Headers({ cookie: 'adiutor.locale=nl-NL' }) };

    await noteRefusalLocale(request, db);

    expect(refusalBody(request, 'TWO_FACTOR_ALREADY_OFF').message).toBe(
      'Verificatie in twee stappen staat al uit. Er is niets gewijzigd.',
    );
  });
});
