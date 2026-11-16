/**
 * @file Tests for the service errors, their messages in each language, and
 * the database error checks.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { NAME_MAX_LENGTH } from '@/lib/input-rules';
import {
  companyNameSchema,
  emailSchema,
  nameSchema,
  passkeyNameSchema,
  passwordSchema,
  slugSchema,
  staffNameSchema,
} from '@/lib/validation';

import {
  CONCURRENT_CHANGE_MESSAGE,
  concurrentChangeError,
  errorMessage,
  isDeadlock,
  isErrorMessageKey,
  isUniqueViolation,
  parseId,
  ServiceError,
  serviceErrorMessage,
  validationErrorMessage,
} from './errors';

describe('ServiceError', () => {
  it('carries the message key and its values, and logs only the key', () => {
    const error = new ServiceError('conflict', 'errors.members.alreadyMember', {
      company: 'Adiutor Tests',
    });
    expect(error).toMatchObject({
      name: 'ServiceError',
      code: 'conflict',
      key: 'errors.members.alreadyMember',
      values: { company: 'Adiutor Tests' },
      message: 'errors.members.alreadyMember',
    });
  });
});

describe('serviceErrorMessage', () => {
  /**
   * "Too many attempts", with a wait the plural chooses the wording for.
   *
   * @param minutes - How long to wait.
   * @returns The error.
   */
  const limited = (minutes: number) =>
    new ServiceError('rate_limited', 'errors.tooManyAttempts', { minutes });

  it.each([
    ['en-US', 1, 'Too many attempts. Try again in 1 minute.'],
    ['en-US', 15, 'Too many attempts. Try again in 15 minutes.'],
    ['nl-NL', 1, 'Te veel pogingen. Probeer het over 1 minuut opnieuw.'],
    ['nl-NL', 15, 'Te veel pogingen. Probeer het over 15 minuten opnieuw.'],
    ['es-ES', 1, 'Demasiados intentos. Vuelve a intentarlo dentro de 1 minuto.'],
    ['es-ES', 15, 'Demasiados intentos. Vuelve a intentarlo dentro de 15 minutos.'],
  ] as const)('words it in %s, with %i minutes', (locale, minutes, message) => {
    expect(serviceErrorMessage(limited(minutes), locale)).toBe(message);
  });

  it('takes messages from the validation catalogue too', () => {
    const invalid = new ServiceError('invalid', 'validation.emailList.invalid', {
      count: 2,
      emails: 'nope, nada',
    });
    expect(serviceErrorMessage(invalid, 'en-US')).toBe(
      'These aren’t valid email addresses: nope, nada.',
    );
    expect(serviceErrorMessage(invalid, 'es-ES')).toBe(
      'Estas direcciones de correo no son válidas: nope, nada.',
    );
  });

  it('names the companies someone is the last Admin of in a whole sentence', () => {
    const sole = new ServiceError('conflict', 'errors.soleAdmin.user.staffAndCompanies', {
      companies: ['Adiutor Tests'],
    });
    expect(serviceErrorMessage(sole, 'en-US')).toBe(
      'This user is the only staff Admin and the only Admin of Adiutor Tests. Make someone else an Admin first.',
    );
    expect(serviceErrorMessage(sole, 'nl-NL')).toBe(
      'Deze gebruiker is de enige beheerder van de medewerkers en de enige beheerder van Adiutor Tests. Maak eerst iemand anders beheerder.',
    );
  });

  it.each([
    ['en-US', 'You are the only Admin of A and B. Make someone else an Admin first.'],
    ['nl-NL', 'Je bent de enige beheerder van A en B. Maak eerst iemand anders beheerder.'],
    ['es-ES', 'Eres el único administrador de A y B. Haz administrador a otra persona primero.'],
  ] as const)('joins a list of two names with the “and” of %s', (locale, message) => {
    const sole = new ServiceError('conflict', 'errors.soleAdmin.self.companies', {
      companies: ['A', 'B'],
    });
    expect(serviceErrorMessage(sole, locale)).toBe(message);
  });

  it.each([
    ['en-US', 'This user is the only Admin of A, B, and C. Make someone else an Admin first.'],
    [
      'nl-NL',
      'Deze gebruiker is de enige beheerder van A, B en C. Maak eerst iemand anders beheerder.',
    ],
    [
      'es-ES',
      'Este usuario es el único administrador de A, B y C. Haz administrador a otra persona primero.',
    ],
  ] as const)('joins a longer list as %s does', (locale, message) => {
    const sole = new ServiceError('conflict', 'errors.soleAdmin.user.companies', {
      companies: ['A', 'B', 'C'],
    });
    expect(serviceErrorMessage(sole, locale)).toBe(message);
  });

  it('leaves the list on the error as it was given', () => {
    const companies = ['A', 'B'];
    const sole = new ServiceError('conflict', 'errors.soleAdmin.self.companies', { companies });
    serviceErrorMessage(sole, 'es-ES');
    expect(sole.values).toEqual({ companies: ['A', 'B'] });
  });
});

describe('isErrorMessageKey', () => {
  it('knows the messages of the errors and validation catalogues', () => {
    expect(isErrorMessageKey('errors.forbidden')).toBe(true);
    expect(isErrorMessageKey('validation.name.empty')).toBe(true);
  });

  it.each([
    'errors',
    'errors.soleAdmin',
    'errors.nothing',
    'common.loading',
    'validation.name.empty.more',
    'Invalid input: expected string, received undefined',
    'errors.constructor',
  ])('refuses %j', (value) => {
    expect(isErrorMessageKey(value)).toBe(false);
  });
});

describe('validationErrorMessage', () => {
  /**
   * The English message for the first problem a schema finds.
   *
   * @param schema - The schema.
   * @param value - The value.
   * @returns The message.
   */
  const englishFor = (schema: z.ZodType, value: unknown) => {
    const result = schema.safeParse(value);
    if (result.success) {
      throw new Error('The value passed.');
    }
    return validationErrorMessage(result.error, 'en-US');
  };

  it('words every field’s problems as before, with the limit from the issue', () => {
    const tooLong = 'a'.repeat(NAME_MAX_LENGTH + 1);
    expect(englishFor(companyNameSchema, 'A')).toBe(
      'Use at least 2 characters for the company name.',
    );
    expect(englishFor(companyNameSchema, tooLong)).toBe(
      'Use at most 100 characters for the company name.',
    );
    expect(englishFor(staffNameSchema, tooLong)).toBe(
      'Use at most 100 characters for the name shown to users.',
    );
    expect(englishFor(nameSchema, tooLong)).toBe('Use at most 100 characters for your name.');
    expect(englishFor(nameSchema, '  ')).toBe('Enter your name.');
    expect(englishFor(nameSchema, 'Alex\u{200B} Admin')).toBe(
      'Remove invisible characters and text direction marks from your name.',
    );
    expect(englishFor(slugSchema, 'a'.repeat(61))).toBe(
      'Use at most 60 characters for the URL name.',
    );
    expect(englishFor(slugSchema, 'Adiutor Tests')).toBe(
      'Use lower-case letters, numbers and dashes in the URL name, e.g. adiutor.',
    );
    expect(englishFor(slugSchema, '01900000-0000-7000-8000-000000000000')).toBe(
      'Choose a URL name that doesn’t look like an ID.',
    );
    expect(englishFor(passwordSchema, 'short')).toBe(
      'Use at least 12 characters for the password.',
    );
    expect(englishFor(passwordSchema, 'a'.repeat(129))).toBe(
      'Use at most 128 characters for the password.',
    );
    expect(englishFor(passkeyNameSchema, 'a'.repeat(65))).toBe(
      'Use at most 64 characters for the passkey name.',
    );
    expect(englishFor(passkeyNameSchema, '')).toBe('Enter a name for the passkey.');
    expect(englishFor(passkeyNameSchema, 'Work\nlaptop')).toBe(
      'Remove line breaks and control characters from the passkey name.',
    );
    expect(englishFor(staffNameSchema, 'Adiutor.dev')).toBe(
      'Remove web addresses from the name shown to users.',
    );
    expect(englishFor(emailSchema, 'nope')).toBe('Enter a valid email address.');
  });

  it('takes values from a refinement’s params', () => {
    const schema = z.string().refine(() => false, {
      error: 'validation.emailList.tooMany',
      params: { max: 20 },
    });
    expect(englishFor(schema, 'x')).toBe(
      'You can invite up to 20 people at once. Split the list and try again.',
    );
  });

  it('asks to check the input when zod worded the problem itself', () => {
    expect(englishFor(z.string(), 42)).toBe('Check your input.');
    expect(validationErrorMessage(new z.ZodError([]), 'nl-NL')).toBe(
      'Controleer wat je hebt ingevuld.',
    );
  });

  it('puts the limit where each language wants it', () => {
    const result = companyNameSchema.safeParse('A');
    if (result.success) {
      throw new Error('The value passed.');
    }
    expect(validationErrorMessage(result.error, 'nl-NL')).toBe(
      'Gebruik minstens 2 tekens voor de bedrijfsnaam.',
    );
    expect(validationErrorMessage(result.error, 'es-ES')).toBe(
      'El nombre de la empresa debe tener al menos 2 caracteres.',
    );
  });
});

describe('parseId', () => {
  it('returns a valid ID unchanged', () => {
    expect(parseId('01900000-0000-7000-8000-000000000000')).toBe(
      '01900000-0000-7000-8000-000000000000',
    );
  });

  it.each(['nope', '', '01900000-0000-7000-8000', ' 01900000-0000-7000-8000-000000000000'])(
    'answers "not found" for %j',
    (value) => {
      expect(() => parseId(value)).toThrow(ServiceError);
      expect(() => parseId(value)).toThrow(
        expect.objectContaining({ code: 'not_found', key: 'errors.notFound' }),
      );
    },
  );
});

describe('database error checks', () => {
  /**
   * Builds an error the way Drizzle throws a failed query: its own error,
   * with the driver's error (carrying the SQLSTATE code) as the cause.
   *
   * @param code - The SQLSTATE code.
   * @returns The wrapped error.
   */
  function drizzleError(code: string): Error {
    return new Error('Failed query', { cause: Object.assign(new Error('driver'), { code }) });
  }

  it('recognises a deadlock (40P01) on the error or its cause', () => {
    expect(isDeadlock(Object.assign(new Error('deadlock detected'), { code: '40P01' }))).toBe(true);
    expect(isDeadlock(drizzleError('40P01'))).toBe(true);
  });

  it('tells deadlocks and unique violations apart from each other and from anything else', () => {
    expect(isDeadlock(drizzleError('23505'))).toBe(false);
    expect(isUniqueViolation(drizzleError('23505'))).toBe(true);
    expect(isUniqueViolation(drizzleError('40P01'))).toBe(false);
    [new Error('nope'), { code: 40 }, null, undefined, '40P01'].forEach((value) => {
      expect(isDeadlock(value)).toBe(false);
    });
  });

  it('asks the user to try again after a concurrent change, as a conflict', () => {
    expect(concurrentChangeError()).toMatchObject({
      code: 'conflict',
      key: CONCURRENT_CHANGE_MESSAGE,
    });
    expect(errorMessage('en-US', CONCURRENT_CHANGE_MESSAGE)).toBe(
      'Someone changed this at the same moment. Try again.',
    );
  });
});
