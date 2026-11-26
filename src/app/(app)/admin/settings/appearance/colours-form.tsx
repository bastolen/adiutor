/**
 * @file Form to choose the brand colours (decision 0047): the accent, an
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
  type BrandColours,
  derivePalette,
  THEME_PALETTE,
  THEME_PANEL,
  typedHexColour,
} from '@/lib/branding';

import saveBrandColoursAction from './actions';
import PalettePreview from './palette-preview';

/** The colours as typed in the form's fields; empty is the theme's own. */
interface TypedColours {
  /** The accent field. */
  accent: string;
  /** The dark accent field. */
  accentDark: string;
  /** The tint field. */
  tint: string;
}

/**
 * The fields' text for saved colours.
 *
 * @param saved - The saved colours.
 * @returns Each colour, or empty for the theme's own.
 */
function typedFrom(saved: BrandColours): TypedColours {
  return { accent: saved.accent ?? '', accentDark: saved.accentDark ?? '', tint: saved.tint ?? '' };
}

/**
 * Three colour fields, the preview, a save button and a button that empties
 * the fields for Adiutor's own colours (saved with the save button, like any
 * other change). The preview follows the fields as they're typed, reading
 * only what's a colour already. Once saved colours change (a save, or
 * someone else's), the fields show them as saved (`#` and lower case).
 *
 * @param props - Form props.
 * @param props.saved - The saved brand colours.
 */
export default function ColoursForm({ saved }: { saved: BrandColours }) {
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
  const brand = useMemo(() => {
    const accent = typedHexColour(typed.accent);
    return derivePalette({
      accent,
      accentDark: accent ? typedHexColour(typed.accentDark) : null,
      tint: typedHexColour(typed.tint),
    });
  }, [typed]);

  /**
   * Changes one field's text.
   *
   * @param key - The field.
   * @returns The change handler for that field.
   */
  const change = (key: keyof TypedColours) => (value: string) => {
    setTyped((current) => ({ ...current, [key]: value }));
  };

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-6">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <div className="grid gap-4 md:grid-cols-3">
          <ColourField
            label={t('accent.label')}
            pickLabel={t('accent.pick')}
            description={t('accent.description')}
            name="accent"
            value={typed.accent}
            onChange={change('accent')}
            fallback={THEME_PALETTE.light.primary}
            disabled={changesOff}
          />
          <ColourField
            label={t('accentDark.label')}
            pickLabel={t('accentDark.pick')}
            description={t('accentDark.description')}
            name="accentDark"
            value={typed.accentDark}
            onChange={change('accentDark')}
            // Empty, dark mode shows the accent worked out for it.
            fallback={brand.palette.dark.primary}
            disabled={changesOff}
          />
          <ColourField
            label={t('tint.label')}
            pickLabel={t('tint.pick')}
            description={t('tint.description')}
            name="tint"
            value={typed.tint}
            onChange={change('tint')}
            fallback={THEME_PANEL.background}
            disabled={changesOff}
          />
        </div>
        <PalettePreview brand={brand} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={changesOff}
            onClick={() => setTyped({ accent: '', accentDark: '', tint: '' })}
          >
            {t('useAdiutor')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
