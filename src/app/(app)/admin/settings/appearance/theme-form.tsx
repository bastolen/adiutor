/**
 * @file Form to keep every page in light or dark mode, or let each person
 * choose (decision 0053). Its text comes from
 * `admin.settings.appearance.theme`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import { THEME_ICONS } from '@/components/theme/theme-options';
import Button from '@/components/ui/button';
import RadioField from '@/components/ui/radio-field';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { type ForcedTheme, THEME_MODE_CHOICES, type ThemeModeChoice } from '@/lib/theme';

import { saveForcedThemeAction } from './actions';

/**
 * Three choices, each with what it means, and a save button. The choice
 * stays as saved after saving (`resetOnSuccess: false`), and every page,
 * this one included, shows the new mode from the next render.
 *
 * @param props - Form props.
 * @param props.saved - The mode every page is kept in, or `null` for both.
 */
export default function ThemeForm({ saved }: { saved: ForcedTheme | null }) {
  const t = useTranslations('admin.settings.appearance.theme');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveForcedThemeAction,
    null,
    { resetOnSuccess: false },
  );
  const current: ThemeModeChoice = saved ?? 'both';

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium text-foreground">{t('legend')}</legend>
          {THEME_MODE_CHOICES.map((choice) => {
            // The icons the theme choices show: both is following the device.
            const Icon = THEME_ICONS[choice === 'both' ? 'system' : choice];
            return (
              <RadioField
                key={choice}
                name="theme"
                value={choice}
                label={t(`${choice}.label`)}
                description={t(`${choice}.description`)}
                leading={<Icon aria-hidden="true" className="size-5 text-muted-foreground" />}
                defaultChecked={current === choice}
                disabled={changesOff}
              />
            );
          })}
        </fieldset>
        <div>
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('save')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
