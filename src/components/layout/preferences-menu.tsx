/**
 * @file Button for choosing the theme and the language, on the pages without
 * the account menu (`AuthLayout` and `CenteredLayout`): floating in the
 * bottom-right corner from tablet width, and at the end of the page below
 * that, where a fixed button would cover the page's last links on a small
 * phone. Signed in, the theme is a row in the account menu and
 * the language is chosen on the account page, saved with the account. On the
 * pages with this button that a signed-in person reaches (the step-up page,
 * an invitation, the not-found and error pages), a language chosen here is
 * saved with their account too (`setLanguageAction`).
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import LanguageFlag from '@/components/language/language-flag';
import { FollowDefaultIcon } from '@/components/language/language-options';
import { useOfferedLocales } from '@/components/language/offered-languages';
import ThemeMenuRow from '@/components/theme/theme-menu-row';
import { THEME_ICONS } from '@/components/theme/theme-options';
import useThemePreference from '@/components/theme/use-theme-preference';
import {
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/dropdown-menu';
import Spinner from '@/components/ui/spinner';
import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import {
  FOLLOW_DEFAULT,
  isLanguageChoice,
  isLocale,
  type LanguageChoice,
  languageCookieValue,
  LOCALE_NAMES,
} from '@/lib/i18n/locales';

import setLanguageAction from './language-action';

/**
 * A pill with two icons split by a thin line: the current theme's (half sun,
 * half moon while following the device) and the language's flag, named in
 * full for screen readers ("Theme and language: System, English (US)"). It
 * opens a menu with the theme as a row of icons, like the account menu
 * (choosing one keeps the menu open, so the result shows at once), and the
 * language: Default first (follow Adiutor's default language, ticked while
 * the browser has no language cookie, which isn't `HttpOnly`, so it's read
 * here when the menu opens), then the languages Adiutor offers, each with its
 * flag, named in itself and marked with its `lang` so screen readers
 * pronounce it right. With only one language offered there's nothing to
 * choose: the language group and the flag go, and the button is named for
 * the theme alone ("Theme: System").
 *
 * Arrow keys move through the items (left and right also within the theme
 * row), Enter or Space chooses, and Escape closes the menu and returns focus
 * to the button. Choosing another language sets the cookie (Default deletes
 * it), saves it with the account of whoever is signed in, and reloads the page
 * in it, so every part of the page (and pages kept alive) changes at once; the
 * button is busy until then. A refused choice (a staff member signed in as
 * the user) changes nothing.
 *
 * @param props - Component props.
 * @param props.className - Where it sits below tablet width, in the page's flow (from tablet
 *   width it's fixed in the bottom-right corner).
 */
export default function PreferencesMenu({ className = '' }: { className?: string }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const offered = useOfferedLocales();
  const chooses = offered.length > 1;
  const { preference, setPreference } = useThemePreference();
  const [pending, startTransition] = useTransition();
  // The browser's choice: read when the menu opens, as the cookie isn't known while rendering.
  const [choice, setChoice] = useState<LanguageChoice>(FOLLOW_DEFAULT);
  const ThemeIcon = THEME_ICONS[preference];

  return (
    <MenuRoot
      onOpenChange={(open) => {
        if (open) {
          const cookie = languageCookieValue(document.cookie);
          // A cookie for a language that's turned off counts as Default, which is what applies.
          setChoice(isLocale(cookie) && offered.includes(cookie) ? cookie : FOLLOW_DEFAULT);
        }
      }}
    >
      <MenuTrigger
        aria-label={
          chooses
            ? t('preferences.button', { theme: preference, language: LOCALE_NAMES[locale] })
            : t('preferences.themeOnly', { theme: preference })
        }
        aria-busy={pending || undefined}
        className={cn(
          'flex h-11 w-fit items-center gap-3 rounded-full border border-border bg-surface px-3.5 text-foreground shadow-lg transition-colors hover:bg-muted aria-busy:cursor-wait data-[state=open]:bg-muted md:fixed md:right-4 md:bottom-4 md:z-40 md:m-0',
          focusRing,
          className,
        )}
      >
        <ThemeIcon aria-hidden="true" className="size-5" />
        {chooses && (
          <>
            {/* The line between the two halves: the theme, then the language. */}
            <span aria-hidden="true" className="h-5 w-px bg-border" />
            {pending ? <Spinner /> : <LanguageFlag locale={locale} />}
          </>
        )}
      </MenuTrigger>
      <MenuContent side="top" align="end" className="min-w-56">
        <ThemeMenuRow preference={preference} onChange={setPreference} />
        {chooses && (
          <>
            <MenuSeparator />
            <MenuLabel>{t('language.label')}</MenuLabel>
            <MenuRadioGroup
              value={choice}
              onValueChange={(value) => {
                if (!isLanguageChoice(value) || value === choice) {
                  return;
                }
                startTransition(async () => {
                  if (await setLanguageAction(value)) {
                    window.location.reload();
                  }
                });
              }}
            >
              <MenuRadioItem value={FOLLOW_DEFAULT}>
                <FollowDefaultIcon />
                {t('language.followDefault')}
              </MenuRadioItem>
              {offered.map((option) => (
                <MenuRadioItem key={option} value={option}>
                  <LanguageFlag locale={option} />
                  <span lang={option}>{LOCALE_NAMES[option]}</span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </>
        )}
      </MenuContent>
    </MenuRoot>
  );
}
