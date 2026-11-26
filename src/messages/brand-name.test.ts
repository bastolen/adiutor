/**
 * @file Guards the staff's name in the catalogues (decision 0050). No text
 * says "Adiutor" except the few that name the software itself, and every text
 * that names the staff (`{staff}`) reads right in every language, both with
 * Adiutor's own name and with a name like a team's: the name never twice
 * around "on", "bij" or "en", and in English never after "a" or "an".
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { type Locale, LOCALES } from '@/lib/i18n/locales';
import translator, { type Namespace } from '@/lib/i18n/translator';

/** The catalogues' folder: one folder per language, one file per namespace. */
const MESSAGES_DIR = import.meta.dirname;

/**
 * The messages that keep "Adiutor", with why: they name the software itself
 * (its colours, setting it up before the staff have a name, the "Powered by
 * Adiutor" credit) or are examples of a name to type.
 */
const KEEPS_ADIUTOR: Readonly<Record<string, string>> = {
  'admin.settings.appearance.colours.useAdiutor': 'the software’s own colours',
  'admin.settings.appearance.colours.accent.description': 'the software’s own accent',
  'admin.settings.appearance.colours.tint.description': 'the software’s own tint',
  'admin.settings.general.name.example': 'an example of a name for the staff',
  'admin.settings.general.name.description':
    'what the name replaces, Adiutor, and the credit it adds',
  'admin.addCompany.form.namePlaceholder': 'an example of a company’s name',
  'admin.settings.email.server.fromNameHint': 'an example of the name mail apps show',
  'auth.setup.title': 'setting up the software, before the staff have a name',
  'auth.setup.heading': 'setting up the software, before the staff have a name',
  'auth.setup.submit': 'setting up the software, before the staff have a name',
  'auth.setup.staffNamePlaceholder': 'the name the staff get unless setup names them',
  'auth.setup.staffNameHint': 'what the name replaces, Adiutor, before the staff have a name',
  'common.poweredBy': 'the credit to the software, once the staff have a name of their own',
  'emails.layout.poweredBy': 'the credit to the software, once the staff have a name of their own',
};

/** The names a text is read with: Adiutor's own, and a name like a team's. */
const STAFF_NAMES = ['Adiutor', 'Adiutor Tests Support'] as const;

/** A catalogue's nested messages. */
interface MessageTree {
  [key: string]: string | MessageTree;
}

/** An ICU argument of a message: its name and kind, and a select's choices. */
interface MessageArgument {
  /** The argument's name, e.g. `staff`. */
  name: string;
  /** How it's formatted: as text, a number (plurals too), a choice, or a tag around text. */
  kind: 'text' | 'number' | 'select' | 'tag';
  /** A select's choices, e.g. `staff` and `other`. */
  choices: string[];
}

/**
 * Lists a catalogue's messages under their full keys.
 *
 * @param tree - The messages.
 * @param prefix - The keys' start so far.
 * @returns `[key, message]` pairs, e.g. `['auth.signIn.heading', 'Sign in to {staff}']`.
 */
function flatten(tree: MessageTree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`),
  );
}

/**
 * A language's messages as written in its own files, without English
 * filling gaps, leaving out the namespaces still to do.
 *
 * @param locale - The language.
 * @returns `[key, message]` pairs.
 */
function catalogue(locale: Locale): [string, string][] {
  return readdirSync(path.join(MESSAGES_DIR, locale))
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) =>
      flatten(
        JSON.parse(readFileSync(path.join(MESSAGES_DIR, locale, file), 'utf8')) as MessageTree,
      ),
    );
}

/**
 * Finds the `}` that closes the `{` just before `start`, skipping nested ones.
 *
 * @param message - The message.
 * @param start - Where the text inside the braces starts.
 * @returns The index of the closing brace.
 */
function closingBrace(message: string, start: number): number {
  let depth = 1;
  for (let at = start; at < message.length; at += 1) {
    if (message[at] === '{') {
      depth += 1;
    } else if (message[at] === '}') {
      depth -= 1;
      if (depth === 0) {
        return at;
      }
    }
  }
  throw new Error(`Unbalanced braces in “${message}”`);
}

/**
 * Lists the arguments a message takes, in the parts of ICU the catalogues
 * use: `{name}`, `{n, number}`, plurals, selects and `<tag>…</tag>`, nested
 * in a plural's or a select's branches too.
 *
 * @param message - The message.
 * @param found - The arguments found so far, by name.
 * @returns The arguments, by name.
 */
function argumentsOf(
  message: string,
  found = new Map<string, MessageArgument>(),
): Map<string, MessageArgument> {
  let at = 0;
  while (at < message.length) {
    const char = message[at];
    if (char === '<') {
      const tag = /^<([A-Za-z]\w*)>/.exec(message.slice(at));
      if (tag?.[1]) {
        found.set(tag[1], { name: tag[1], kind: 'tag', choices: [] });
      }
      at += 1;
    } else if (char === '{') {
      const end = closingBrace(message, at + 1);
      const [name = '', type = '', ...rest] = message.slice(at + 1, end).split(',');
      const body = rest.join(',');
      const kind = type.trim();
      if (kind === 'plural' || kind === 'selectordinal' || kind === 'select') {
        const choices: string[] = [];
        let inner = 0;
        while (inner < body.length) {
          const open = body.indexOf('{', inner);
          if (open === -1) {
            break;
          }
          choices.push(body.slice(inner, open).trim());
          const close = closingBrace(body, open + 1);
          argumentsOf(body.slice(open + 1, close), found);
          inner = close + 1;
        }
        found.set(name.trim(), {
          name: name.trim(),
          kind: kind === 'select' ? 'select' : 'number',
          choices,
        });
      } else {
        found.set(name.trim(), {
          name: name.trim(),
          kind: kind === '' ? 'text' : 'number',
          choices: [],
        });
      }
      at = end + 1;
    } else {
      at += 1;
    }
  }
  return found;
}

/**
 * Every set of values to format a message with that names the staff: each
 * choice of each select, a plural's one and many, a sample for other text,
 * and the staff's name for `{staff}`. A message with a `target` select
 * names the staff as the company too when the target is the staff.
 *
 * @param args - The message's arguments.
 * @param staff - The staff's name.
 * @returns The sets of values.
 */
function valueSets(
  args: Map<string, MessageArgument>,
  staff: string,
): Record<string, string | number | ((chunks: string) => string)>[] {
  let sets: Record<string, string | number | ((chunks: string) => string)>[] = [{}];
  for (const arg of args.values()) {
    let options: (string | number | ((chunks: string) => string))[];
    if (arg.name === 'staff') {
      options = [staff];
    } else if (arg.kind === 'tag') {
      options = [(chunks: string) => chunks];
    } else if (arg.kind === 'select') {
      options = arg.choices;
    } else if (arg.kind === 'number') {
      options = [1, 3];
    } else {
      // Someone's or something's name, never the staff's (a company's is, when it's the target).
      options = [arg.name === 'company' ? 'Adiutor Tests Client' : 'Jane Doe'];
    }
    sets = sets.flatMap((set) => options.map((option) => ({ ...set, [arg.name]: option })));
  }
  return sets.map((set) =>
    set.target === 'staff' && 'company' in set ? { ...set, company: staff } : set,
  );
}

/**
 * Escapes a name for a regular expression.
 *
 * @param text - The name.
 * @returns The pattern that matches it as it is.
 */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('the staff’s name in the catalogues', () => {
  it.each(LOCALES)('keeps “Adiutor” only where it names the software itself, in %s', (locale) => {
    const sayAdiutor = catalogue(locale)
      .filter(([, message]) => message.includes('Adiutor'))
      .map(([key]) => key);

    expect(sayAdiutor.filter((key) => !(key in KEEPS_ADIUTOR))).toEqual([]);
  });

  it('lists only messages that still say “Adiutor” as the ones that keep it', () => {
    const english = new Map(catalogue('en-US'));
    for (const key of Object.keys(KEEPS_ADIUTOR)) {
      expect(english.get(key), key).toContain('Adiutor');
    }
  });

  const namingStaff = catalogue('en-US').filter(([, message]) => message.includes('{staff}'));

  it('has messages that name the staff', () => {
    expect(namingStaff.length).toBeGreaterThan(10);
  });

  describe.each(LOCALES)('in %s', (locale) => {
    it.each(namingStaff.map(([key, message]) => [key, message] as const))(
      'reads %s right with any name',
      (key, message) => {
        const cut = key.lastIndexOf('.');
        const t = translator(locale, key.slice(0, cut) as Namespace);
        for (const staff of STAFF_NAMES) {
          const name = literally(staff);
          const texts = valueSets(argumentsOf(message), staff).map((values) =>
            t.markup(key.slice(cut + 1) as never, values as never),
          );
          // A select may leave the name out of some of its sentences, never out of all.
          expect(
            texts.some((text) => text.includes(staff)),
            key,
          ).toBe(true);
          for (const text of texts) {
            expect(text, key).not.toMatch(new RegExp(`${name},? (on|bij|en|op) ${name}`));
            expect(text, key).not.toMatch(new RegExp(`${name} ${name}`));
            if (locale === 'en-US') {
              expect(text, key).not.toMatch(new RegExp(`\\b[Aa]n? ${name}`));
            }
          }
        }
      },
    );
  });
});
