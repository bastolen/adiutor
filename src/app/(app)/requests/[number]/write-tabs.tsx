/**
 * @file What the staff who work on requests write at the end of a request's
 * conversation: a reply to the company, or an internal note, on two tabs.
 * Its text comes from `requests.note`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { Lock, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';

import Tabs from '@/components/ui/tabs';

import NoteForm from './note-form';
import ReplyForm from './reply-form';

/**
 * The tabs "Reply" and "Internal note", each with its own form and draft: a
 * note that's half written never becomes a reply by switching tabs. "Reply"
 * is open to begin with.
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @param props.canWait - Whether the reply form offers "Send and wait for the company".
 * @param props.canPropose - Whether the reply form offers "Send as solution".
 */
export default function WriteTabs({
  request,
  canWait,
  canPropose = false,
}: {
  request: number;
  canWait: boolean;
  canPropose?: boolean;
}) {
  const t = useTranslations('requests.note');
  return (
    <Tabs
      label={t('tabsLabel')}
      items={[
        {
          value: 'reply',
          label: t('replyTab'),
          icon: MessageSquare,
          content: <ReplyForm request={request} canWait={canWait} canPropose={canPropose} />,
        },
        {
          value: 'note',
          label: t('noteTab'),
          icon: Lock,
          content: <NoteForm request={request} />,
        },
      ]}
    />
  );
}
