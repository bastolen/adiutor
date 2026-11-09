/**
 * @file Decorative example of a request, shown on the brand panel of the
 * public pages to show what Adiutor is for. Its text comes from the root
 * provider (`common.brandPanel.preview`), like the rest of the panel.
 */
'use client';

import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

/** The example request's reference: an identifier, the same in every language. */
const REFERENCE = 'REQ-142';

/**
 * The days the example messages were sent on: a Monday and the Tuesday
 * after, named by `Intl` in the reader's language ("Mon", "ma", "lun").
 */
const DAYS = {
  question: new Date(Date.UTC(2026, 9, 26)),
  answer: new Date(Date.UTC(2026, 9, 27)),
} as const;

/**
 * Takes the first character a reader sees in a name ("Y" for "You", "T" for
 * "Tú"), for an avatar with a single initial.
 *
 * @param name - The name.
 * @param locale - The reader's language, for upper-casing.
 * @returns The initial.
 */
function firstLetter(name: string, locale: string): string {
  const [first = ''] = Array.from(name.normalize('NFC'));
  return first.toLocaleUpperCase(locale);
}

/**
 * An example request card with its conversation and approval buttons, with a
 * second card behind it for depth: a company user asks, the staff answers.
 * Purely decorative: it's meant for a panel hidden from assistive
 * technology, and it's `inert`, so nothing in it can be focused, clicked,
 * hovered or selected. The buttons are decorative look-alikes without hover,
 * focus or press effects.
 *
 * @returns The example request.
 */
export default function RequestPreview() {
  const t = useTranslations('common');
  const locale = useLocale();
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  const you = t('brandPanel.preview.you');
  const messages = [
    {
      id: 'question',
      author: you,
      // A single initial for "You"; the staff's name gives two.
      avatar: firstLetter(you, locale),
      when: weekday.format(DAYS.question),
      staff: false,
      text: t('brandPanel.preview.question'),
    },
    {
      id: 'answer',
      author: t('brandPanel.preview.staff'),
      avatar: t('brandPanel.preview.staff'),
      when: weekday.format(DAYS.answer),
      staff: true,
      text: t('brandPanel.preview.answer'),
    },
  ];

  return (
    <div inert className="pointer-events-none relative w-full max-w-md cursor-default select-none">
      <div className="absolute inset-x-6 -bottom-3 h-full rounded-xl border border-border bg-surface/60" />
      <div className="relative flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 text-foreground shadow-2xl">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-muted-foreground">{REFERENCE}</span>
            <Badge tone="warning">{t('brandPanel.preview.status')}</Badge>
          </div>
          <p className="text-base font-semibold">{t('brandPanel.preview.title')}</p>
        </div>
        <ol className="flex flex-col gap-3 border-t border-border pt-4">
          {messages.map((message) => (
            <li key={message.id} className="flex gap-3">
              <Avatar name={message.avatar} size="sm" brand={message.staff} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs">
                  <span className="font-medium">{message.author}</span>
                  <span className="text-muted-foreground"> · {message.when}</span>
                </p>
                <p className="rounded-lg bg-muted px-3 py-2 text-sm">{message.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex justify-end gap-2">
          <Button decorative variant="secondary" size="sm">
            {t('brandPanel.preview.reply')}
          </Button>
          <Button decorative size="sm">
            <Check aria-hidden="true" />
            {t('brandPanel.preview.approve')}
          </Button>
        </div>
      </div>
    </div>
  );
}
