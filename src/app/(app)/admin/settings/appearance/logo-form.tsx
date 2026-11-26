/**
 * @file Form to upload the logo (decision 0052), with a preview of it on
 * the light and the dark palette, and a button to remove it. Its text comes
 * from `admin.settings.appearance.logo`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import {
  type BrandColours,
  type BrandLogo,
  derivePalette,
  LOGO_RATIO,
  paletteVariables,
  THEME_MODES,
  type ThemeMode,
} from '@/lib/branding';
import { BRAND_IMAGE_MAX_MB, BRAND_LOGO_MIN_HEIGHT } from '@/lib/input-rules';

import { removeBrandImageAction, uploadBrandImageAction } from './actions';
import { BrandImageField, fileIn, useChosenImage, useImageRefusal } from './brand-image-field';

/** Adiutor's logo in each mode: dark text on light, light text on dark. */
const ADIUTOR_LOGOS: Readonly<Record<ThemeMode, string>> = {
  light: '/brand/logo.svg',
  dark: '/brand/logo-on-dark.svg',
};

/**
 * The logo on a page of each mode, in the brand's palette: the chosen image
 * before it's uploaded, else the uploaded logo, else Adiutor's. Only to
 * look at (`inert`).
 *
 * @param props - Preview props.
 * @param props.src - The image to show, or `null` for Adiutor's.
 * @param props.colours - The saved brand colours, for each mode's page.
 */
function LogoPreview({ src, colours }: { src: string | null; colours: BrandColours }) {
  const t = useTranslations('admin.settings.appearance.logo');
  const brand = useMemo(() => derivePalette(colours), [colours]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {THEME_MODES.map((mode) => (
        <figure key={mode} className="flex flex-col gap-2">
          <div
            inert
            data-testid={`logo-${mode}`}
            style={{ ...paletteVariables(brand, mode), colorScheme: mode }}
            className="flex h-20 items-center rounded-xl border border-border bg-surface px-5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- A blob: preview or Adiutor's own file; the image optimizer can't fetch the first and needn't copy the others. */}
            <img
              src={src ?? ADIUTOR_LOGOS[mode]}
              alt=""
              className="h-8 w-auto max-w-full object-contain object-left"
            />
          </div>
          <figcaption className="text-xs font-medium text-foreground">{t(mode)}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * The logo's preview, a file field, an upload button and, once a logo is
 * uploaded, a button to remove it (through a confirmation). A chosen file is
 * checked in the browser first (a PNG or JPEG, not too large); the server
 * checks the rest. After an upload, the field is emptied and the preview
 * shows the logo as saved.
 *
 * @param props - Form props.
 * @param props.logo - The uploaded logo, or `null` while it's Adiutor's.
 * @param props.colours - The saved brand colours, for the preview.
 */
export default function LogoForm({
  logo,
  colours,
}: {
  logo: BrandLogo | null;
  colours: BrandColours;
}) {
  const t = useTranslations('admin.settings.appearance.logo');
  const formId = useId();
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    uploadBrandImageAction,
    null,
  );
  const [chosen, choose] = useChosenImage();
  const refusalOf = useImageRefusal();
  const [refusal, setRefusal] = useState('');
  let caption = t('adiutors');
  if (chosen) {
    caption = t('chosen');
  } else if (logo) {
    caption = '';
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        id={formId}
        action={formAction}
        onSubmit={(event) => {
          const refused = refusalOf(fileIn(event.currentTarget));
          if (refused) {
            event.preventDefault();
            setRefusal(refused);
            return;
          }
          setRefusal('');
          onSubmit(event);
        }}
        onReset={() => choose(null)}
        className="flex flex-col gap-6"
      >
        <ChangesFieldset>
          <ResultAlert result={result} />
          <Alert tone="error" alsoToast onDismiss={() => setRefusal('')}>
            {refusal}
          </Alert>
          <input type="hidden" name="kind" value="logo" />
          <section aria-label={t('preview')} className="flex flex-col gap-2">
            <LogoPreview src={chosen?.url ?? logo?.src ?? null} colours={colours} />
            {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
          </section>
          <BrandImageField
            label={t('field')}
            description={t('fieldDescription', {
              maximum: BRAND_IMAGE_MAX_MB,
              minimum: BRAND_LOGO_MIN_HEIGHT,
              widest: LOGO_RATIO.widest,
            })}
            disabled={changesOff}
            onChoose={(file) => {
              setRefusal('');
              choose(file);
            }}
          />
        </ChangesFieldset>
      </form>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" form={formId} loading={pending} disabled={changesOff}>
          {t('upload')}
        </Button>
        {logo ? (
          <ActionDialog
            action={removeBrandImageAction}
            fields={{ kind: 'logo' }}
            triggerLabel={t('remove')}
            triggerVariant="danger-subtle"
            title={t('removeTitle')}
            description={t('removeDescription')}
            confirmLabel={t('remove')}
          />
        ) : null}
      </div>
    </div>
  );
}
