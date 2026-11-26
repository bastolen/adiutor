/**
 * @file Form for the browser tab icon (decision 0052): what it is now and
 * where it comes from, at a tab's size and as on a phone's home screen, a
 * field to upload an own icon instead, and a button to remove that one. Its
 * text comes from `admin.settings.appearance.icon`, which the page passes
 * through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { useStaffName } from '@/components/brand/staff-name';
import ActionDialog from '@/components/ui/action-dialog';
import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { brandIconPath, type BrandIconSource } from '@/lib/branding';
import { BRAND_ICON_MIN_SIDE, BRAND_IMAGE_MAX_MB } from '@/lib/input-rules';

import { removeBrandImageAction, uploadBrandImageAction } from './actions';
import { BrandImageField, fileIn, useChosenImage, useImageRefusal } from './brand-image-field';

/** The icon made from the brand, as the page passes it. */
export interface ShownIcon {
  /** Its version, for its address. */
  version: string;
  /** What it's drawn from. */
  source: BrandIconSource['kind'];
}

/** Adiutor's own icon. */
const ADIUTOR_ICON = '/brand/icon.svg';

/**
 * The icon at a browser tab's size and as on a phone's home screen (the
 * touch icon at half its size), each with what it is. The pictures are only
 * to look at (`inert`); their captions stay for screen readers.
 *
 * @param props - Preview props.
 * @param props.tab - The tab icon's address.
 * @param props.touch - The touch icon's address.
 */
function IconPreview({ tab, touch }: { tab: string; touch: string }) {
  const t = useTranslations('admin.settings.appearance.icon');
  return (
    <div className="flex flex-wrap items-end gap-6">
      <figure className="flex flex-col items-start gap-2">
        <div
          inert
          className="flex size-14 items-center justify-center rounded-lg border border-border bg-muted"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Adiutor's own icon, a blob: preview or one Adiutor drew at its versioned address; nothing for the image optimizer. */}
          <img src={tab} alt="" width={32} height={32} className="size-8 object-contain" />
        </div>
        <figcaption className="text-xs font-medium text-foreground">{t('tab')}</figcaption>
      </figure>
      <figure className="flex flex-col items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- As above. */}
        <img
          inert
          src={touch}
          alt=""
          width={90}
          height={90}
          className="size-[90px] rounded-[20px] border border-border object-contain"
        />
        <figcaption className="text-xs font-medium text-foreground">{t('touch')}</figcaption>
      </figure>
    </div>
  );
}

/**
 * The icon's preview and where it comes from, a field for an own icon, an
 * upload button and, once an own icon is uploaded, a button to remove it
 * (through a confirmation), which goes back to the icon made from the logo.
 *
 * @param props - Form props.
 * @param props.icon - The icon made from the brand, or `null` while it's Adiutor's.
 * @param props.ownIcon - Whether an own icon was uploaded.
 */
export default function IconForm({ icon, ownIcon }: { icon: ShownIcon | null; ownIcon: boolean }) {
  const t = useTranslations('admin.settings.appearance.icon');
  const staff = useStaffName();
  const formId = useId();
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    uploadBrandImageAction,
    null,
  );
  const [chosen, choose] = useChosenImage();
  const refusalOf = useImageRefusal();
  const [refusal, setRefusal] = useState('');
  const tab = chosen?.url ?? (icon ? brandIconPath(icon.version, 32) : ADIUTOR_ICON);
  const touch = chosen?.url ?? (icon ? brandIconPath(icon.version, 180) : ADIUTOR_ICON);
  const source = chosen ? t('chosen') : t(`source.${icon?.source ?? 'adiutor'}`, { staff });

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
          <input type="hidden" name="kind" value="icon" />
          <div className="flex flex-col gap-2">
            <IconPreview tab={tab} touch={touch} />
            <p className="text-xs text-muted-foreground">{source}</p>
          </div>
          <BrandImageField
            label={t('field')}
            description={t('fieldDescription', {
              maximum: BRAND_IMAGE_MAX_MB,
              minimum: BRAND_ICON_MIN_SIDE,
            })}
            chosenName={chosen?.file.name}
            disabled={changesOff}
            onChoose={(file) => {
              setRefusal('');
              choose(file);
            }}
          />
        </ChangesFieldset>
      </form>
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          form={formId}
          variant="secondary"
          loading={pending}
          disabled={changesOff}
        >
          {t('upload')}
        </Button>
        {ownIcon ? (
          <ActionDialog
            action={removeBrandImageAction}
            fields={{ kind: 'icon' }}
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
