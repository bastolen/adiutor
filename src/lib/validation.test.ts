/**
 * @file Tests for shared validation.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { NAME_MAX_LENGTH, PASSKEY_NAME_MAX_LENGTH, SLUG_MAX_LENGTH } from './input-rules';
import {
  CHOOSE_COMPANY_ROLE_MESSAGE,
  CHOOSE_STAFF_ROLE_MESSAGE,
  companyNameSchema,
  companyRoleSchema,
  emailSchema,
  idSchema,
  nameSchema,
  passkeyNameSchema,
  passwordSchema,
  roleSchema,
  slugSchema,
  staffNameSchema,
  staffRoleSchema,
} from './validation';

describe('emailSchema', () => {
  it('normalizes emails so they match stored addresses', () => {
    expect(emailSchema.parse('  Jane.Doe@Adiutor.TEST ')).toBe('jane.doe@adiutor.test');
  });

  it('rejects invalid emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('idSchema', () => {
  it('accepts UUIDv7 and rejects anything else', () => {
    expect(idSchema.safeParse('019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b').success).toBe(true);
    expect(idSchema.safeParse('1').success).toBe(false);
  });
});

describe('roleSchema', () => {
  it('accepts known roles only', () => {
    expect(roleSchema.safeParse('watcher').success).toBe(true);
    expect(roleSchema.safeParse('owner').success).toBe(false);
  });
});

describe('companyRoleSchema and staffRoleSchema', () => {
  /**
   * The message a schema refuses a value with, if it does.
   *
   * @param result - What `safeParse` returned.
   * @returns The first issue's message, or `undefined` when the value passed.
   */
  const refusal = (result: z.ZodSafeParseResult<string>) => result.error?.issues[0]?.message;

  it('accepts the company roles only, refusing the rest with one message', () => {
    expect(['admin', 'client', 'watcher'].map((role) => companyRoleSchema.parse(role))).toEqual([
      'admin',
      'client',
      'watcher',
    ]);
    ['manager', 'platform_admin', 'owner', ''].forEach((role) => {
      expect(refusal(companyRoleSchema.safeParse(role))).toBe(CHOOSE_COMPANY_ROLE_MESSAGE);
    });
  });

  it('accepts the staff roles only, refusing the rest with one message', () => {
    expect(
      ['platform_admin', 'manager', 'finance', 'support'].map((role) =>
        staffRoleSchema.parse(role),
      ),
    ).toEqual(['platform_admin', 'manager', 'finance', 'support']);
    ['admin', 'client', 'owner', ''].forEach((role) => {
      expect(refusal(staffRoleSchema.safeParse(role))).toBe(CHOOSE_STAFF_ROLE_MESSAGE);
    });
  });
});

describe('display names (person and company)', () => {
  it('accept ordinary names, including abbreviations with single-letter parts', () => {
    ['Jane Doe', "O'Brien & Sons", 'Adiutor B.V.', 'José', 'Dr. Smith', 'X Æ A-12'].forEach(
      (name) => {
        expect(nameSchema.safeParse(name).success, name).toBe(true);
        expect(companyNameSchema.safeParse(name).success, name).toBe(true);
      },
    );
  });

  it('reject control characters and line breaks', () => {
    ['Jane\nDoe', 'Jane\tDoe', 'Jane\u0000Doe', 'Line1\r\nLine2'].forEach((name) => {
      expect(nameSchema.safeParse(name).success, name).toBe(false);
      expect(companyNameSchema.safeParse(name).success, name).toBe(false);
    });
  });

  it('reject web addresses: schemes, www and bare domains', () => {
    [
      'Click https://evil.example now',
      'Evil http://evil.example',
      'www.evil.example',
      'evil.example',
      'support at evil.co.uk',
      'Node.js Foundation',
    ].forEach((name) => {
      expect(nameSchema.safeParse(name).success, name).toBe(false);
      expect(companyNameSchema.safeParse(name).success, name).toBe(false);
    });
  });

  it('accept apostrophes, initials, hyphens and the joiners real names need', () => {
    [
      'Renée O’Neil',
      'J.R.R. Tolkien',
      'Adiutor B.V.',
      'Mary-Jane Watson',
      'Adiutor Tests 2.0',
      // Persian "mi-khaham", with a zero-width non-joiner (U+200C) after the prefix.
      '\u{645}\u{6CC}\u{200C}\u{62E}\u{648}\u{627}\u{647}\u{645}',
      // Devanagari with a zero-width joiner (U+200D), and an emoji family joined by them.
      '\u{915}\u{94D}\u{200D}\u{937}',
      'Adiutor Tests \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}',
      // A Catalan middle dot and a Japanese name separator aren't full stops.
      'Paral\u{B7}lel',
      '\u{30B8}\u{30E7}\u{30F3}\u{30FB}\u{30B9}\u{30DF}\u{30B9}',
    ].forEach((name) => {
      expect(nameSchema.safeParse(name).success, name).toBe(true);
      expect(companyNameSchema.safeParse(name).success, name).toBe(true);
    });
  });

  it('reject characters that hide or reorder text', () => {
    [
      // Text direction controls: overrides, embeddings, isolates and marks.
      '\u{202E}moc.nigol-rotuida',
      'Alex \u{202E}nimdA',
      'Alex \u{202A}Admin\u{202C}',
      'Alex \u{2066}Admin\u{2069}',
      'Alex \u{2067}Admin\u{2069}',
      'Alex\u{200E} Admin',
      'Alex\u{200F} Admin',
      'Alex\u{61C} Admin',
      // Invisible characters.
      'Alex\u{200B} Admin',
      'Alex\u{2060} Admin',
      'Alex\u{2063} Admin',
      'Alex\u{FEFF} Admin',
      // Line and paragraph separators.
      'Alex\u{2028}Admin',
      'Alex\u{2029}Admin',
    ].forEach((name) => {
      const result = nameSchema.safeParse(name);
      expect(result.success, name).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'validation.name.hiddenCharacters',
      );
      expect(companyNameSchema.safeParse(name).success, name).toBe(false);
    });
    // At either end they're trimmed away, like spaces.
    expect(nameSchema.parse('\u{FEFF}Alex Admin\u{2028}')).toBe('Alex Admin');
  });

  it('reject web addresses written with look-alike dots, full-width letters or hidden characters', () => {
    [
      'Security team: sign in at adiutor-login\u{3002}com',
      'Security team: sign in at adiutor-login\u{FF0E}com',
      'Security team: sign in at adiutor-login\u{FF61}com',
      'Security team: sign in at adiutor-login\u{2024}com',
      'Security team: sign in at adiutor-login\u{FE52}com',
      'adiutor-login\u{FF0E}\u{FF43}\u{FF4F}\u{FF4D}',
      'Security team: sign in at adiutor-login.c\u{200B}om',
      // Joiners are allowed in names, but not inside a domain.
      'Security team: sign in at adiutor-login.c\u{200D}om',
      // A soft hyphen is a format character too.
      'Security team: sign in at adiutor-login.c\u{AD}om',
      '\u{FF48}\u{FF54}\u{FF54}\u{FF50}\u{FF53}\u{FF1A}\u{FF0F}\u{FF0F}adiutor',
    ].forEach((name) => {
      expect(nameSchema.safeParse(name).success, name).toBe(false);
      expect(companyNameSchema.safeParse(name).success, name).toBe(false);
    });
  });

  it('reject domains in other scripts and bare IPv4 addresses', () => {
    [
      // Cyrillic look-alike letters.
      'sign in at \u{430}diutor.\u{440}\u{444}',
      'adiutor-login.\u{441}om',
      // A Devanagari top-level domain, whose vowel signs are marks.
      'adiutor.\u{92D}\u{93E}\u{930}\u{924}',
      'sign in at 203.0.113.7/login',
      '203.0.113.7',
      '203\u{FF0E}0\u{FF0E}113\u{FF0E}7',
    ].forEach((name) => {
      expect(nameSchema.safeParse(name).success, name).toBe(false);
      expect(companyNameSchema.safeParse(name).success, name).toBe(false);
    });
  });
});

describe('passkeyNameSchema', () => {
  it('accepts names of 1 to 64 characters, trimmed, web addresses included', () => {
    expect(passkeyNameSchema.parse('  Work laptop ')).toBe('Work laptop');
    expect(passkeyNameSchema.safeParse('a').success).toBe(true);
    expect(passkeyNameSchema.safeParse('a'.repeat(PASSKEY_NAME_MAX_LENGTH)).success).toBe(true);
    // It isn't quoted in emails, so a name like a device's model passes.
    expect(passkeyNameSchema.safeParse('1Password on adiutor.dev').success).toBe(true);
  });

  it('refuses empty and too long names', () => {
    ['', '   ', 'a'.repeat(PASSKEY_NAME_MAX_LENGTH + 1)].forEach((name) => {
      expect(passkeyNameSchema.safeParse(name).success, name).toBe(false);
    });
  });

  it('refuses line breaks, control characters and characters that hide or reorder text', () => {
    [
      'Work\nlaptop',
      'Work\tlaptop',
      'Work \u{202E}potpal',
      'Work\u{200B} laptop',
      'Work \u{2066}laptop\u{2069}',
      'Work\u{FEFF} laptop',
      'Work\u{2028}laptop',
    ].forEach((name) => {
      expect(passkeyNameSchema.safeParse(name).success, name).toBe(false);
    });
  });

  it('allows the joiners real names need', () => {
    expect(passkeyNameSchema.safeParse('\u{915}\u{94D}\u{200D}\u{937} laptop').success).toBe(true);
  });
});

describe('slugs', () => {
  it('validates slugs', () => {
    expect(slugSchema.safeParse('adiutor-tests').success).toBe(true);
    expect(slugSchema.safeParse('Adiutor Tests').success).toBe(false);
    expect(slugSchema.safeParse('-adiutor').success).toBe(false);
  });
});

describe('messages', () => {
  /**
   * The first issue a schema refuses a value with: its message is a key in
   * the `validation` catalogue, and a length check carries its limit.
   *
   * @param schema - The schema.
   * @param value - The value.
   * @returns The issue, or `undefined` when the value passed.
   */
  const issueFor = (schema: z.ZodType, value: string) => schema.safeParse(value).error?.issues[0];

  it('name the field, since forms show one message above all their fields', () => {
    const tooLong = 'a'.repeat(NAME_MAX_LENGTH + 1);
    expect(issueFor(companyNameSchema, 'A')).toMatchObject({
      message: 'validation.companyName.tooShort',
      minimum: 2,
    });
    expect(issueFor(companyNameSchema, tooLong)).toMatchObject({
      message: 'validation.companyName.tooLong',
      maximum: NAME_MAX_LENGTH,
    });
    expect(issueFor(staffNameSchema, tooLong)).toMatchObject({
      message: 'validation.staffName.tooLong',
      maximum: NAME_MAX_LENGTH,
    });
    expect(issueFor(nameSchema, tooLong)).toMatchObject({
      message: 'validation.name.tooLong',
      maximum: NAME_MAX_LENGTH,
    });
    expect(issueFor(nameSchema, '  ')?.message).toBe('validation.name.empty');
    expect(issueFor(slugSchema, 'a'.repeat(SLUG_MAX_LENGTH + 1))).toMatchObject({
      message: 'validation.slug.tooLong',
      maximum: SLUG_MAX_LENGTH,
    });
    expect(issueFor(slugSchema, 'Adiutor Tests')?.message).toBe('validation.slug.format');
    expect(issueFor(passwordSchema, 'short')).toMatchObject({
      message: 'validation.password.tooShort',
      minimum: 12,
    });
    expect(issueFor(passwordSchema, 'a'.repeat(129))).toMatchObject({
      message: 'validation.password.tooLong',
      maximum: 128,
    });
    expect(issueFor(passkeyNameSchema, 'a'.repeat(PASSKEY_NAME_MAX_LENGTH + 1))).toMatchObject({
      message: 'validation.passkeyName.tooLong',
      maximum: PASSKEY_NAME_MAX_LENGTH,
    });
    expect(issueFor(passkeyNameSchema, ' ')?.message).toBe('validation.passkeyName.empty');
    expect(issueFor(passkeyNameSchema, 'Work\nlaptop')?.message).toBe(
      'validation.passkeyName.controlCharacters',
    );
    expect(issueFor(emailSchema, 'nope')?.message).toBe('validation.email');
    expect(issueFor(idSchema, 'nope')?.message).toBe('validation.id');
    expect(issueFor(roleSchema, 'owner')?.message).toBe('validation.role');
  });

  it('refuse a URL name that looks like an ID, since the company’s address takes both', () => {
    expect(issueFor(slugSchema, '01900000-0000-7000-8000-000000000000')?.message).toBe(
      'validation.slug.looksLikeId',
    );
    expect(issueFor(slugSchema, 'adiutor-tests')).toBeUndefined();
  });

  it('call the staff name the name shown to users, not a company name', () => {
    expect(issueFor(staffNameSchema, 'Adiutor.dev')?.message).toBe(
      'validation.staffName.webAddress',
    );
    expect(issueFor(companyNameSchema, 'Adiutor.dev')?.message).toBe(
      'validation.companyName.webAddress',
    );
    expect(issueFor(companyNameSchema, 'Adiutor\tTests')?.message).toBe(
      'validation.companyName.controlCharacters',
    );
  });
});
