/**
 * @file Floating button in the bottom-right corner for choosing the theme and
 * the language, on the pages without the account menu (`AuthLayout` and
 * `CenteredLayout`). Signed in, the theme is a row in the account menu and
 * the language is chosen on the account page, saved with the account.
 */
'use client';

import { Palette } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import setLanguageAction from '@/app/language-action';
import LanguageFlag from '@/components/language/language-flag';
import { FollowDefaultIcon } from '@/components/language/language-options';
import { THEME_ICONS } from '@/components/theme/theme-options';
import useThemePreference from '@/components/theme/use-theme-preference';
import {
  MenuContent,
  MenuIconRadioItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioRow,
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
  LOCALES,
} from '@/lib/i18n/locales';
import { isThemePreference, THEME_PREFERENCES } from '@/lib/theme';

/**
 * A pill with two icons split by a thin line: the current theme's (half sun,
 * half moon while following the device) and the language's flag, named in
 * full for screen readers ("Theme and language: System, English (US)"). It
 * opens a menu with the theme as a row of icons, like the account menu
 * (choosing one keeps the menu open, so the result shows at once), and the
 * language: Default first (follow Adiutor's default language, ticked while
 * the browser has no language cookie, which isn't `HttpOnly`, so it's read
 * here when the menu opens), then the languages, each with its flag, named in
 * itself and marked with its `lang` so screen readers pronounce it right.
 *
 * Arrow keys move through the items (left and right also within the theme
 * row), Enter or Space chooses, and Escape closes the menu and returns focus
 * to the button. Choosing another language sets the cookie (Default deletes
 * it) and reloads the page in it, so every part of the page (and pages kept
 * alive) changes at once; the button is busy until then.
 *
 * @returns The theme and language button.
 */
export default function PreferencesMenu() {
  const t = useTranslations('common');
  const themeText = useTranslations('common.theme');
  const locale = useLocale();
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
          setChoice(isLocale(cookie) ? cookie : FOLLOW_DEFAULT);
        }
      }}
    >
      <MenuTrigger
        aria-label={t('preferences.button', { theme: preference, language: LOCALE_NAMES[locale] })}
        aria-busy={pending || undefined}
        className={cn(
          'fixed right-4 bottom-4 z-40 flex h-11 items-center gap-3 rounded-full border border-border bg-surface px-3.5 text-foreground shadow-lg transition-colors hover:bg-muted aria-busy:cursor-wait data-[state=open]:bg-muted',
          focusRing,
        )}
      >
        <ThemeIcon aria-hidden="true" className="size-5" />
        {/* The line between the two halves: the theme, then the language. */}
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        {pending ? <Spinner /> : <LanguageFlag locale={locale} />}
      </MenuTrigger>
      <MenuContent side="top" align="end" className="min-w-56">
        <MenuRadioRow
          label={themeText('label')}
          icon={Palette}
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) {
              setPreference(value);
            }
          }}
        >
          {THEME_PREFERENCES.map((option) => (
            <MenuIconRadioItem
              key={option}
              value={option}
              label={themeText(option)}
              icon={THEME_ICONS[option]}
            />
          ))}
        </MenuRadioRow>
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
          {LOCALES.map((option) => (
            <MenuRadioItem key={option} value={option}>
              <LanguageFlag locale={option} />
              <span lang={option}>{LOCALE_NAMES[option]}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
