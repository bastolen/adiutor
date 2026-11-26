/**
 * @file The file field of the logo and icon forms on the Appearance tab
 * (decision 0052), with the image chosen in it before it's uploaded and the
 * checks the browser can make first: a file is chosen, it's a PNG or JPEG
 * and it isn't too large. Its size and shape are the server's to check. Its
 * text comes from `admin.settings.appearance` and `errors.branding`, which
 * the page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { focusRing } from '@/components/ui/styles';
import { IMAGE_CONTENT_TYPES } from '@/lib/branding';
import cn from '@/lib/cn';
import { BRAND_IMAGE_ACCEPT, BRAND_IMAGE_MAX_MB } from '@/lib/input-rules';

/** The image chosen in a field, and an address for its preview. */
export interface ChosenImage {
  /** The file. */
  file: File;
  /** A `blob:` address showing it, until another is chosen or the form goes. */
  url: string;
}

/**
 * The image chosen in a field, with an address to preview it that's let go
 * when another is chosen, the field is emptied or the form goes.
 *
 * @returns The chosen image, if any, and the function that changes it.
 */
export function useChosenImage(): [ChosenImage | null, (file: File | null) => void] {
  const [chosen, setChosen] = useState<ChosenImage | null>(null);
  const shown = useRef<string | null>(null);
  const choose = useCallback((file: File | null) => {
    if (shown.current) {
      URL.revokeObjectURL(shown.current);
    }
    const url = file ? URL.createObjectURL(file) : null;
    shown.current = url;
    setChosen(file && url ? { file, url } : null);
  }, []);
  useEffect(
    () => () => {
      if (shown.current) {
        URL.revokeObjectURL(shown.current);
      }
    },
    [],
  );
  return [chosen, choose];
}

/**
 * Why an image can't be uploaded, as far as the browser can tell, so a file
 * too large never reaches the server.
 *
 * @returns A function giving the refusal's text for a file, or `null` when
 *   it may be sent.
 */
export function useImageRefusal(): (file: File | null | undefined) => string | null {
  const t = useTranslations('admin.settings.appearance');
  const tErrors = useTranslations('errors.branding');
  return (file) => {
    if (!file) {
      return t('chooseFirst');
    }
    if (file.size === 0) {
      return tErrors('empty');
    }
    if (file.size > BRAND_IMAGE_MAX_MB * 1024 * 1024) {
      return tErrors('tooLarge', { maximum: BRAND_IMAGE_MAX_MB });
    }
    return Object.values(IMAGE_CONTENT_TYPES).includes(file.type)
      ? null
      : tErrors('typeNotAllowed');
  };
}

/**
 * The file a form's image field holds now: read from the field itself, not
 * from what the page remembers, so a file chosen before the page's script
 * ran (or kept by the browser on its way back) still counts.
 *
 * @param form - The form.
 * @returns The file, if one is chosen.
 */
export function fileIn(form: HTMLFormElement): File | undefined {
  const field = form.elements.namedItem('file');
  return field instanceof HTMLInputElement ? field.files?.[0] : undefined;
}

/** Props for {@link BrandImageField}. */
interface BrandImageFieldProps {
  /** Visible label text. */
  label: string;
  /** Help text under the field: what an image may be. */
  description: string;
  /** Whether the field is turned off (signed in as a user). */
  disabled?: boolean;
  /** Called with the file chosen, or `null` when the choice is emptied. */
  onChoose: (file: File | null) => void;
}

/**
 * A labelled file field for one PNG or JPEG, submitted as `file`. The
 * browser's own control, so choosing a file works with the keyboard and
 * screen readers as everywhere else; its button looks like a secondary one.
 *
 * @param props - Field props.
 * @param props.label - Visible label text.
 * @param props.description - Help text under the field.
 * @param props.disabled - Whether the field is turned off.
 * @param props.onChoose - Called with the file chosen, or `null`.
 */
export function BrandImageField({
  label,
  description,
  disabled = false,
  onChoose,
}: BrandImageFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type="file"
        name="file"
        accept={BRAND_IMAGE_ACCEPT}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => onChoose(event.target.files?.[0] ?? null)}
        className={cn(
          'block w-full max-w-md cursor-pointer rounded-lg text-sm wrap-anywhere text-muted-foreground',
          'file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground file:shadow-xs',
          'hover:file:bg-muted disabled:cursor-not-allowed disabled:file:cursor-not-allowed disabled:file:opacity-55',
          focusRing,
        )}
      />
      <p id={descriptionId} className="text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
