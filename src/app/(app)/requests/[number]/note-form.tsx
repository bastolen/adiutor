/**
 * @file The form that adds an internal note to a request, on its own tab
 * next to the reply form. Its text comes from `requests.note` and
 * `requests.reply`, which the page passes through `ClientMessages`.
 */
'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import Button from '@/components/ui/button';
import MarkdownField from '@/components/ui/markdown/markdown-field';
import ResultAlert from '@/components/ui/result-alert';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import { mentionChoicesAction } from '../../_requests/mention-actions';
import { noteAction } from './actions';

/**
 * A text field on the amber surface notes are shown on, saying that only
 * the staff see it, with a button that adds the note. After a note is added
 * the field is empty again, and the button keeps focus; a refused one keeps
 * what was typed. A note can mention anyone a reply can, and unlike a reply
 * it may link to the staff's pages (`staffOnly`).
 *
 * @param props - Form props.
 * @param props.request - The request's number.
 * @returns The form.
 */
export default function NoteForm({ request }: { request: number }) {
  const t = useTranslations('requests.note');
  const tReply = useTranslations('requests.reply');
  const [result, formAction, pending, onSubmit] = useTransientActionState(noteAction, null);
  // Who the note can mention: asked for when someone types "@".
  const loadMentions = useCallback(
    () => mentionChoicesAction({ request: String(request) }),
    [request],
  );

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-lg bg-warning-soft p-4"
    >
      <input type="hidden" name="request" value={request} />
      <p className="flex items-center gap-2 text-sm font-medium text-warning">
        <Lock aria-hidden="true" className="size-4 shrink-0" />
        {t('staffOnly')}
      </p>
      <ResultAlert result={result} />
      <MarkdownField
        label={t('label')}
        description={tReply('hint')}
        name="body"
        rows={6}
        maxLength={REQUEST_TEXT_MAX_LENGTH}
        required
        mentions={loadMentions}
        staffOnly
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {t('add')}
        </Button>
      </div>
    </form>
  );
}
