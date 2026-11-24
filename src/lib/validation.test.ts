/**
 * @file Tests for shared validation.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  IMPERSONATION_REASON_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSKEY_NAME_MAX_LENGTH,
  REQUEST_PREFIX_MAX_LENGTH,
  REQUEST_TEXT_MAX_LENGTH,
  REQUEST_TYPE_NAME_MAX_LENGTH,
  REQUEST_TITLE_MAX_LENGTH,
  SLUG_MAX_LENGTH,
} from './input-rules';
import {
  CHOOSE_COMPANY_ROLE_MESSAGE,
  CHOOSE_STAFF_ROLE_MESSAGE,
  companyNameSchema,
  companyRoleSchema,
  containsWebAddress,
  emailSchema,
  idSchema,
  impersonationReasonSchema,
  nameSchema,
  passkeyNameSchema,
  passwordSchema,
  requestCompanySchema,
  requestDescriptionSchema,
  requestPrefixSchema,
  requestPrioritySchema,
  requestReplySchema,
  requestStatusSchema,
  requestTitleSchema,
  requestTypeDescriptionSchema,
  requestTypeNameSchema,
  requestTypeSchema,
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
      'Alex\u{34F} Admin',
      'Alex\u{17B4} Admin',
      'a\u{180E}',
      'Alex\u{2065} Admin',
      'Alex\u{206A} Admin',
      // Fillers: letters to Unicode, blank to the eye. A name of only one shows as nothing.
      '\u{3164}',
      '\u{3164}\u{3164}',
      'Alex\u{115F} Admin',
      'Alex\u{1160} Admin',
      'Alex\u{FFA0} Admin',
      // Tag characters.
      '\u{E0041}x',
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

  it('reject a name with nothing to see in it', () => {
    [
      // The joiners names need are allowed inside a name, but aren't a name.
      '\u{200C}\u{200C}',
      '\u{200D}\u{200D}',
      // Accents and variation selectors change a character; alone they show nothing.
      '\u{301}\u{301}',
      '\u{FE0F}\u{FE0F}',
      // A soft hyphen and a blank Braille pattern.
      '\u{AD}\u{AD}',
      '\u{2800}\u{2800}',
    ].forEach((name) => {
      expect(
        nameSchema.safeParse(name).error?.issues.map((issue) => issue.message),
        name,
      ).toEqual(['validation.name.noVisibleCharacter']);
      expect(
        companyNameSchema.safeParse(name).error?.issues.map((issue) => issue.message),
        name,
      ).toEqual(['validation.companyName.noVisibleCharacter']);
      expect(
        staffNameSchema.safeParse(name).error?.issues.map((issue) => issue.message),
        name,
      ).toEqual(['validation.staffName.noVisibleCharacter']);
    });
    // One such character is no name either.
    expect(nameSchema.safeParse('\u{200C}').success).toBe(false);
    // A filler is refused as a hidden character first: that message says what to remove.
    expect(nameSchema.safeParse('\u{3164}').error?.issues[0]?.message).toBe(
      'validation.name.hiddenCharacters',
    );
  });

  it('accept names whose joiners, accents and emoji come with something to see', () => {
    [
      // Persian "mi-khaham", with a zero-width non-joiner (U+200C) after the prefix.
      '\u{645}\u{6CC}\u{200C}\u{62E}\u{648}\u{627}\u{647}\u{645}',
      // An emoji made with the variation selector (U+FE0F), alone and after a name.
      '\u{2764}\u{FE0F}\u{2764}\u{FE0F}',
      'Adiutor Tests \u{2764}\u{FE0F}',
      // A letter with a combining accent.
      'Zoe\u{308}',
    ].forEach((name) => {
      expect(nameSchema.safeParse(name).success, name).toBe(true);
      expect(companyNameSchema.safeParse(name).success, name).toBe(true);
      expect(staffNameSchema.safeParse(name).success, name).toBe(true);
    });
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

describe('a name far too long', () => {
  /** A megabyte, what a form or an action can send, with a line break halfway that a later rule refuses. */
  const megabyte = `${'a'.repeat(500_000)}\n${'a'.repeat(500_000)}`;

  it.each([
    ['nameSchema', nameSchema, 'validation.name.tooLong'],
    ['companyNameSchema', companyNameSchema, 'validation.companyName.tooLong'],
    ['staffNameSchema', staffNameSchema, 'validation.staffName.tooLong'],
    ['requestTypeNameSchema', requestTypeNameSchema, 'validation.requestTypeName.tooLong'],
    ['passkeyNameSchema', passkeyNameSchema, 'validation.passkeyName.tooLong'],
    ['requestTitleSchema', requestTitleSchema, 'validation.requestTitle.tooLong'],
    [
      'requestTypeDescriptionSchema',
      requestTypeDescriptionSchema,
      'validation.requestTypeDescription.tooLong',
    ],
    [
      'impersonationReasonSchema',
      impersonationReasonSchema,
      'validation.impersonationReason.tooLong',
    ],
  ] as const)('is refused by %s for its length alone, quickly', (_name, schema, tooLong) => {
    const started = performance.now();
    const issues = schema.safeParse(megabyte).error?.issues.map((issue) => issue.message);
    const took = performance.now() - started;

    // The rules after the length never read it: the web-address check alone would take minutes.
    expect(issues).toEqual([tooLong]);
    expect(took).toBeLessThan(1000);
  });
});

describe('containsWebAddress', () => {
  it.each([
    ['a long word, then a dot', `${'a'.repeat(1_000_000)}.`],
    ['words joined by dashes, then a dot', `${'a-'.repeat(500_000)}.`],
    [
      'letters with accents and dashes, then a dot',
      `${`a${'\u{301}'.repeat(50)}-`.repeat(19_000)}.`,
    ],
    ['initials, then slashes after something else', `${'a.'.repeat(500_000)}#://`],
    ['a scheme of digits', `${'1'.repeat(1_000_000)}://`],
    ['many schemes of digits', `${'1'.repeat(100)}://`.repeat(9_700)],
  ])('reads %s in time in proportion to its length', (_what, text) => {
    const started = performance.now();
    const found = containsWebAddress(text);
    const took = performance.now() - started;

    expect(found).toBe(false);
    // Reading on from each character to the end would take minutes; reading once, milliseconds.
    expect(took).toBeLessThan(1000);
  });

  it('still finds an address after a long run of letters', () => {
    const run = 'a'.repeat(1_000_000);
    expect(containsWebAddress(`${run} adiutor.dev`)).toBe(true);
    expect(containsWebAddress(`${run} https://x`)).toBe(true);
    expect(containsWebAddress(`${run}-${'\u{301}'.repeat(3)}.dev`)).toBe(true);
    expect(containsWebAddress(`${run} www.x`)).toBe(true);
  });

  it('finds a scheme only in a word that starts with a letter, and no label ending in a dash', () => {
    expect(containsWebAddress('adiutor-.dev')).toBe(false);
    expect(containsWebAddress('1http://')).toBe(false);
    expect(containsWebAddress('_http://')).toBe(false);
    expect(containsWebAddress('+http://')).toBe(true);
    expect(containsWebAddress('1a://')).toBe(false);
    expect(containsWebAddress('1.a://')).toBe(true);
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

describe('impersonationReasonSchema', () => {
  it('keeps a trimmed reason, web addresses included, and makes an empty one null', () => {
    expect(impersonationReasonSchema.parse('  Ticket at https://adiutor.dev/t/12 ')).toBe(
      'Ticket at https://adiutor.dev/t/12',
    );
    expect(impersonationReasonSchema.parse('')).toBeNull();
    expect(impersonationReasonSchema.parse('   ')).toBeNull();
    expect(
      impersonationReasonSchema.safeParse('a'.repeat(IMPERSONATION_REASON_MAX_LENGTH)).success,
    ).toBe(true);
  });

  it('refuses reasons that are too long, or hide or break text', () => {
    ['a'.repeat(IMPERSONATION_REASON_MAX_LENGTH + 1), 'Line\nbreak', 'Hidden \u{202E}txet'].forEach(
      (reason) => {
        expect(impersonationReasonSchema.safeParse(reason).success, reason).toBe(false);
      },
    );
  });
});

describe('requestTitleSchema', () => {
  it('keeps a trimmed title, web addresses included', () => {
    expect(requestTitleSchema.parse('  portal.adiutor.dev is down ')).toBe(
      'portal.adiutor.dev is down',
    );
    expect(requestTitleSchema.safeParse('a'.repeat(REQUEST_TITLE_MAX_LENGTH)).success).toBe(true);
  });

  it('refuses titles that are empty, too long, of several lines, or that hide text', () => {
    [
      '',
      '   ',
      'a'.repeat(REQUEST_TITLE_MAX_LENGTH + 1),
      'Two\nlines',
      'Hidden \u{202E}txet',
    ].forEach((title) => {
      expect(requestTitleSchema.safeParse(title).success, title).toBe(false);
    });
  });
});

describe('requestDescriptionSchema and requestReplySchema', () => {
  it('keep the lines of a text and clean it instead of refusing it', () => {
    expect(
      requestDescriptionSchema.parse('  Steps:\r\n1. Open the page\u200b\r\n2. Wait\u0000 '),
    ).toBe('Steps:\n1. Open the page\n2. Wait');
    expect(requestReplySchema.parse('See https://adiutor.dev/docs\n\nThanks!')).toBe(
      'See https://adiutor.dev/docs\n\nThanks!',
    );
  });

  it('count the length of what is saved, not of what the form sent', () => {
    // A form sends a line break as two characters; saved, it is one.
    const lines = `${'a'.repeat(REQUEST_TEXT_MAX_LENGTH - 2)}\r\nb`;
    expect(lines.length).toBe(REQUEST_TEXT_MAX_LENGTH + 1);
    expect(requestDescriptionSchema.parse(lines)).toHaveLength(REQUEST_TEXT_MAX_LENGTH);
    expect(requestReplySchema.safeParse('a'.repeat(REQUEST_TEXT_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });

  it('refuse a text with nothing to read in it', () => {
    ['', '  \r\n ', '\u200b\u0000'].forEach((text) => {
      expect(requestDescriptionSchema.safeParse(text).success, text).toBe(false);
      expect(requestReplySchema.safeParse(text).success, text).toBe(false);
    });
  });
});

describe('requestCompanySchema', () => {
  it('takes a URL name or an ID as it was chosen, trimmed', () => {
    expect(requestCompanySchema.parse(' adiutor-tests ')).toBe('adiutor-tests');
    expect(requestCompanySchema.parse('01890a5d-ac96-774b-bcce-b302099a8057')).toBe(
      '01890a5d-ac96-774b-bcce-b302099a8057',
    );
  });

  it('asks for a company when none was chosen', () => {
    ['', '   ', undefined, null].forEach((value) => {
      expect(requestCompanySchema.safeParse(value).error?.issues[0]?.message).toBe(
        'validation.requestCompany',
      );
    });
  });
});

describe('request types, priorities and statuses', () => {
  it('accept their own values only', () => {
    expect(requestTypeSchema.parse('new_feature')).toBe('new_feature');
    // Any key of the right form: whether a type has it is for the services.
    expect(requestTypeSchema.parse('printers_2')).toBe('printers_2');
    expect(requestTypeSchema.safeParse('New feature').success).toBe(false);
    expect(requestTypeSchema.safeParse('').success).toBe(false);
    expect(requestPrioritySchema.parse('high')).toBe('high');
    expect(requestPrioritySchema.safeParse('urgent').success).toBe(false);
    expect(requestStatusSchema.parse('in_progress').toString()).toBe('in_progress');
    expect(requestStatusSchema.safeParse('closed').success).toBe(false);
  });
});

describe('requestPrefixSchema', () => {
  it('saves the prefix in capitals', () => {
    expect(requestPrefixSchema.parse(' ad ')).toBe('AD');
    expect(requestPrefixSchema.parse('help1')).toBe('HELP1');
    expect(requestPrefixSchema.parse('a'.repeat(REQUEST_PREFIX_MAX_LENGTH))).toBe('AAAAA');
  });

  it('refuses anything that is not one to five letters or digits starting with a letter', () => {
    ['', '1AD', 'A-D', 'A D', 'a'.repeat(REQUEST_PREFIX_MAX_LENGTH + 1), 'ÄD'].forEach((prefix) => {
      expect(requestPrefixSchema.safeParse(prefix).success, prefix).toBe(false);
    });
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
    expect(issueFor(requestTitleSchema, ' ')?.message).toBe('validation.requestTitle.empty');
    expect(issueFor(requestTitleSchema, 'a'.repeat(REQUEST_TITLE_MAX_LENGTH + 1))).toMatchObject({
      message: 'validation.requestTitle.tooLong',
      maximum: REQUEST_TITLE_MAX_LENGTH,
    });
    expect(issueFor(requestTitleSchema, 'Two\nlines')?.message).toBe(
      'validation.requestTitle.controlCharacters',
    );
    expect(issueFor(requestDescriptionSchema, ' ')?.message).toBe(
      'validation.requestDescription.empty',
    );
    expect(
      issueFor(requestDescriptionSchema, 'a'.repeat(REQUEST_TEXT_MAX_LENGTH + 1)),
    ).toMatchObject({
      message: 'validation.requestDescription.tooLong',
      maximum: REQUEST_TEXT_MAX_LENGTH,
    });
    expect(issueFor(requestReplySchema, ' ')?.message).toBe('validation.requestReply.empty');
    expect(issueFor(requestReplySchema, 'a'.repeat(REQUEST_TEXT_MAX_LENGTH + 1))).toMatchObject({
      message: 'validation.requestReply.tooLong',
      maximum: REQUEST_TEXT_MAX_LENGTH,
    });
    expect(issueFor(requestTypeSchema, 'New feature')?.message).toBe('validation.requestType');
    expect(issueFor(requestTypeNameSchema, ' ')?.message).toBe('validation.requestTypeName.empty');
    expect(
      issueFor(requestTypeNameSchema, 'a'.repeat(REQUEST_TYPE_NAME_MAX_LENGTH + 1)),
    ).toMatchObject({
      message: 'validation.requestTypeName.tooLong',
      maximum: REQUEST_TYPE_NAME_MAX_LENGTH,
    });
    expect(issueFor(requestTypeNameSchema, 'See https://adiutor.dev')?.message).toBe(
      'validation.requestTypeName.webAddress',
    );
    expect(issueFor(requestTypeDescriptionSchema, '')?.message).toBe(
      'validation.requestTypeDescription.empty',
    );
    expect(issueFor(requestTypeDescriptionSchema, 'Two\nlines')?.message).toBe(
      'validation.requestTypeDescription.controlCharacters',
    );
    expect(issueFor(requestPrioritySchema, 'urgent')?.message).toBe('validation.requestPriority');
    expect(issueFor(requestStatusSchema, 'closed')?.message).toBe('validation.requestStatus');
    expect(issueFor(requestPrefixSchema, 'a-d')?.message).toBe('validation.requestPrefix');
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
