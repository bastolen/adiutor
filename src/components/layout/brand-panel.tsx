/**
 * @file The decorative brand panel of the public pages: an example request
 * and the product pitch, on the fixed ink background. A client component, so
 * its text comes from the root provider (`common.brandPanel`): the public
 * layout is in each page's static shell, which Partial Prefetching
 * prefetches without reading the request (docs/i18n.md).
 */
'use client';

import { useTranslations } from 'next-intl';

import RequestPreview from './request-preview';

/**
 * The panel on the right of the public pages on large screens, hidden from
 * assistive technology (it only shows what Adiutor is for). The pitch speaks
 * to companies, the people who raise requests.
 *
 * @returns The panel.
 */
export default function BrandPanel() {
  const t = useTranslations('common');
  return (
    <div
      aria-hidden="true"
      // eslint-disable-next-line better-tailwindcss/no-restricted-classes -- The brand panel is the same dark ink in light and dark mode.
      className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12"
    >
      <div className="absolute -top-40 -right-40 size-[36rem] rounded-full bg-brand-green/20 blur-3xl" />
      <div className="absolute -bottom-48 -left-32 size-[32rem] rounded-full bg-brand-teal/50 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* Spacer as tall as the logo row on the left, so the example request stays centred. */}
      <div className="h-8" />
      <RequestPreview />
      <div className="relative flex max-w-md flex-col gap-4">
        {/* eslint-disable-next-line better-tailwindcss/no-restricted-classes -- White on the ink brand panel, which doesn't change with the mode. */}
        <p className="text-3xl font-semibold tracking-tight text-white">
          {t('brandPanel.headline')}
        </p>
        {/* eslint-disable-next-line better-tailwindcss/no-restricted-classes -- On the fixed ink panel, white at 75% still has a contrast of about 10:1. */}
        <p className="text-base text-white/75">{t('brandPanel.pitch')}</p>
      </div>
    </div>
  );
}
