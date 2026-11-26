/**
 * @file Form to choose the brand colours (decision 0049): the accent, an
 * accent for dark mode and the tint, with a preview of the palette they make
 * as they're typed. Its text comes from `admin.settings.appearance.colours`,
 * which the page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import Button from '@/components/ui/button';
import ColourField from '@/components/ui/colour-field';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import {
  ADIUTOR_COLOURS,
  type BrandColours,
  derivePalette,
  followedDarkAccent,
  storedBrandColours,
  THEME_MODES,
  typedHexColour,
} from '@/lib/branding';
import cn from '@/lib/cn';
import type { ForcedTheme } from '@/lib/theme';

import saveBrandColoursAction from './actions';
import PalettePreview from './palette-preview';

/** The colours as typed in the form's fields; empty is Adiutor's own. */
interface TypedColours {
  /** The accent field. */
  accent: string;
  /** The dark accent field, once it no longer follows the accent. */
  accentDark: string;
  /** The tint field. */
  tint: string;
  /** Whether the dark accent field shows the accent instead of a colour of its own. */
  darkFollows: boolean;
}

/** The fields as "Use Adiutor's colours" leaves them. */
const ADIUTOR_TYPED: TypedColours = {
  accent: ADIUTOR_COLOURS.accent,
  accentDark: '',
  tint: ADIUTOR_COLOURS.tint,
  darkFollows: true,
};

/**
 * The fields for saved colours: each colour, or Adiutor's for none, and a
 * dark accent that follows the accent while none is saved.
 *
 * @param saved - The saved colours.
 * @returns The fields' text.
 */
function typedFrom(saved: BrandColours): TypedColours {
  return {
    accent: saved.accent ?? ADIUTOR_COLOURS.accent,
    accentDark: saved.accentDark ?? '',
    tint: saved.tint ?? ADIUTOR_COLOURS.tint,
    darkFollows: saved.accentDark === null,
  };
}

/**
 * Three colour fields, the preview, a save button and a button that puts
 * Adiutor's own colours back in the fields (saved with the save button, like
 * any other change). The fields always show the colours in use: Adiutor's
 * while none are saved. The dark accent follows the accent as it's typed
 * until it's changed; emptied, it follows again once saved. The form sends
 * what the fields show, and the service stores a colour that's the one used
 * anyway as none (`storedBrandColours`); the preview takes the colours
 * through the same rule, so it shows what will be saved, reading only what's
 * a colour already. Once saved colours change (a save, or someone else's),
 * the fields show them as saved (`#` and lower case).
 *
 * While a staff Admin keeps every page in light mode (decision 0053), the
 * dark accent's field and preview aren't shown, but its value is still sent
 * as it is, so saving the colours never clears it for when both modes come
 * back. In dark mode only, both previews but the dark one go, and the
 * accent's description says it's for the emails and the tab icon.
 *
 * @param props - Form props.
 * @param props.saved - The saved brand colours.
 * @param props.forced - The mode every page is kept in, or `null` for both.
 */
export default function ColoursForm({
  saved,
  forced = null,
}: {
  saved: BrandColours;
  forced?: ForcedTheme | null;
}) {
  const t = useTranslations('admin.settings.appearance.colours');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    saveBrandColoursAction,
    null,
    // The fields show the saved colours (below), so the form keeps them after a save.
    { resetOnSuccess: false },
  );
  const [typed, setTyped] = useState(() => typedFrom(saved));
  const savedKey = `${saved.accent ?? ''}|${saved.accentDark ?? ''}|${saved.tint ?? ''}`;
  const [shownSaved, setShownSaved] = useState(savedKey);
  if (shownSaved !== savedKey) {
    setShownSaved(savedKey);
    setTyped(typedFrom(saved));
  }
  const chosen = useMemo(
    () =>
      storedBrandColours({
        accent: typedHexColour(typed.accent),
        accentDark: typed.darkFollows ? null : typedHexColour(typed.accentDark),
        tint: typedHexColour(typed.tint),
      }),
    [typed],
  );
  const brand = useMemo(() => derivePalette(chosen), [chosen]);
  // What dark mode starts from without a dark accent of its own.
  const followed = followedDarkAccent(chosen.accent);
  // A saved dark accent that was stored as none follows the accent again, even when the saved
  // colours didn't change (so the fields above weren't shown afresh). An update on top of the
  // fields as they are, in case they were just shown afresh from the saved colours.
  const [handledResult, setHandledResult] = useState(result);
  if (handledResult !== result) {
    setHandledResult(result);
    if (result?.ok && !typed.darkFollows && chosen.accentDark === null) {
      setTyped((current) => ({ ...current, darkFollows: true }));
    }
  }

  /**
   * Changes one field's text. A change to the dark accent stops it following
   * the accent.
   *
   * @param key - The field.
   * @returns The change handler for that field.
   */
  const change = (key: 'accent' | 'accentDark' | 'tint') => (value: string) => {
    setTyped((current) => ({
      ...current,
      [key]: value,
      darkFollows: key === 'accentDark' ? false : current.darkFollows,
    }));
  };

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-6">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <div className={cn('grid gap-4', forced === 'light' ? 'md:grid-cols-2' : 'md:grid-cols-3')}>
          <ColourField
            label={t('accent.label')}
            pickLabel={t('accent.pick')}
            description={
              forced === 'dark' ? t('accent.descriptionDarkOnly') : t('accent.description')
            }
            name="accent"
            value={typed.accent}
            onChange={change('accent')}
            fallback={ADIUTOR_COLOURS.accent}
            disabled={changesOff}
          />
          {forced === 'light' ? (
            // Dark mode is off: the dark accent waits as it is, for when both modes come back.
            <input
              type="hidden"
              name="accentDark"
              value={typed.darkFollows ? followed : typed.accentDark}
            />
          ) : (
            <ColourField
              label={t('accentDark.label')}
              pickLabel={t('accentDark.pick')}
              description={t('accentDark.description')}
              name="accentDark"
              value={typed.darkFollows ? followed : typed.accentDark}
              onChange={change('accentDark')}
              fallback={followed}
              disabled={changesOff}
            />
          )}
          <ColourField
            label={t('tint.label')}
            pickLabel={t('tint.pick')}
            description={t('tint.description')}
            name="tint"
            value={typed.tint}
            onChange={change('tint')}
            fallback={ADIUTOR_COLOURS.tint}
            disabled={changesOff}
          />
        </div>
        <PalettePreview brand={brand} modes={forced ? [forced] : THEME_MODES} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={changesOff}
            onClick={() => setTyped(ADIUTOR_TYPED)}
          >
            {t('useAdiutor')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
