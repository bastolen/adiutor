/**
 * @file The form at the end of a request's conversation that replies to it.
 * Its text comes from `requests.reply`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useLayoutEffect, useRef, useState } from 'react';

import Button, { whileRunning } from '@/components/ui/button';
import restoreFocusIfLost from '@/components/ui/focus-fallback';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextAreaField from '@/components/ui/textarea-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import { replyAction } from './actions';

/** The form's two buttons: send the reply, or send it and wait for the company. */
type ReplyButton = 'send' | 'sendAndWait';

/**
 * A text field with a button that sends the reply. For the staff, on a
 * request they can still put a question to, a second button sends it and
 * sets the request to wait for the company's answer. After a reply is sent
 * the field is empty again; a refused one keeps what was typed. The second
 * button goes once the request waits: if it had focus, focus moves to the
 * conversation's heading instead of being lost. While a reply is sent, only
 * the button that sent it is busy, and the other is disabled
 * (`whileRunning`).
 *
 * @param props - Form props.
 * @param props.request - The request's number.
 * @param props.canWait - Whether to offer "Send and wait for the company".
 * @returns The form.
 */
export default function ReplyForm({ request, canWait }: { request: number; canWait: boolean }) {
  const t = useTranslations('requests.reply');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(replyAction, null);
  // The button that sent the reply running now (Send, also for a submit without a button).
  const [pressed, setPressed] = useState<ReplyButton>('send');
  const running = pending ? pressed : null;
  const send = whileRunning<ReplyButton>(running, 'send');
  const sendAndWait = whileRunning<ReplyButton>(running, 'sendAndWait');
  const formRef = useRef<HTMLFormElement>(null);
  // Whether "Send and wait for the company" was there at the last render.
  const couldWait = useRef(canWait);

  useLayoutEffect(() => {
    // That button just went (the request waits now): don't leave focus on <body>.
    if (couldWait.current && !canWait) {
      restoreFocusIfLost(formRef.current);
    }
    couldWait.current = canWait;
  }, [canWait]);

  /**
   * Notes which button sent the form, then sends it.
   *
   * @param event - The submit event.
   */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const { submitter } = event.nativeEvent as SubmitEvent;
    setPressed(submitter?.getAttribute('value') === 'waiting' ? 'sendAndWait' : 'send');
    onSubmit(event);
  };

  return (
    <form ref={formRef} action={formAction} onSubmit={submit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <input type="hidden" name="request" value={request} />
        <ResultAlert result={result} />
        <TextAreaField
          label={t('label')}
          description={t('hint')}
          name="body"
          rows={4}
          maxLength={REQUEST_TEXT_MAX_LENGTH}
          required
          disabled={changesOff}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={send.loading} disabled={changesOff || send.disabled}>
            {t('send')}
          </Button>
          {canWait && (
            <Button
              type="submit"
              variant="secondary"
              name="status"
              value="waiting"
              loading={sendAndWait.loading}
              disabled={changesOff || sendAndWait.disabled}
            >
              {t('sendAndWait')}
            </Button>
          )}
        </div>
      </ChangesFieldset>
    </form>
  );
}
