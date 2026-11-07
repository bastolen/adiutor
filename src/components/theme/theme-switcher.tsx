/**
 * @file Floating button in the bottom-right corner for choosing light, dark
 * or system theme, on the pages without the account menu (`AuthLayout` and
 * `CenteredLayout`). Signed in, the same choice is a row in the account menu.
 */
'use client';

import {
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui/dropdown-menu';
import { focusRing } from '@/components/ui/styles';
import cn from '@/lib/cn';
import { isThemePreference, THEME_PREFERENCES } from '@/lib/theme';

import { THEME_ICONS, THEME_LABELS } from './theme-options';
import useThemePreference from './use-theme-preference';

/**
 * A round button showing the current choice. It opens a menu with the three
 * options as radio items: arrow keys move between them, Enter or Space
 * chooses, and Escape closes the menu and returns focus to the button.
 *
 * @returns The theme switcher.
 */
export default function ThemeSwitcher() {
  const { preference, setPreference } = useThemePreference();
  const CurrentIcon = THEME_ICONS[preference];

  return (
    <MenuRoot>
      <MenuTrigger
        aria-label={`Theme: ${THEME_LABELS[preference]}`}
        className={cn(
          'fixed right-4 bottom-4 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-lg transition-colors hover:bg-muted data-[state=open]:bg-muted',
          focusRing,
        )}
      >
        <CurrentIcon aria-hidden="true" className="size-5" />
      </MenuTrigger>
      <MenuContent side="top" align="end" className="min-w-40">
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) {
              setPreference(value);
            }
          }}
        >
          {THEME_PREFERENCES.map((option) => {
            const OptionIcon = THEME_ICONS[option];
            return (
              <MenuRadioItem key={option} value={option}>
                <OptionIcon aria-hidden="true" />
                {THEME_LABELS[option]}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
