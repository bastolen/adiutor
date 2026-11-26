/**
 * @file A preview of a palette in light and in dark mode, side by side, for
 * the brand colours form. Its text comes from
 * `admin.settings.appearance.colours.preview`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import { type BrandPalette, paletteVariables, THEME_MODES } from '@/lib/branding';

/**
 * Two small pages, one per mode, built from the real components with the
 * palette's colours set on them (custom properties, so they don't depend on
 * the page's own mode): a card with a heading, secondary text, a link, the
 * main button, an accent badge and a field with the focus ring. They're only
 * to look at (`inert`); under each, its mode and, when the accent had to
 * move for the text to stay readable, the colour that will be used.
 *
 * @param props - Preview props.
 * @param props.brand - The palette worked out from the colours as typed.
 */
export default function PalettePreview({ brand }: { brand: BrandPalette }) {
  const t = useTranslations('admin.settings.appearance.colours.preview');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        {t('title')}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        {THEME_MODES.map((mode) => (
          <figure key={mode} className="flex flex-col gap-2">
            <div
              inert
              data-testid={`preview-${mode}`}
              style={{ ...paletteVariables(brand, mode), colorScheme: mode }}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-foreground shadow-xs">
                <p className="font-semibold">{t('heading')}</p>
                <p className="text-sm text-muted-foreground">{t('text')}</p>
                <p className="text-sm font-medium text-highlight underline underline-offset-2">
                  {t('link')}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" size="sm">
                    {t('button')}
                  </Button>
                  <Badge tone="accent">{t('badge')}</Badge>
                  <span className="rounded-lg border border-border-strong bg-surface px-3 py-1 text-sm text-muted-foreground outline-2 outline-offset-2 outline-ring">
                    {t('field')}
                  </span>
                </div>
              </div>
            </div>
            <figcaption className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t(mode)}</span>
              {brand.adjusted[mode] ? (
                <span>{t(`adjusted.${mode}`, { colour: brand.palette[mode].primary })}</span>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
