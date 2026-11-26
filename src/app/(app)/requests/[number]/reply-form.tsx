/**
 * @file The form at the end of a request's conversation that replies to it.
 * Its text comes from `requests.reply`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useLayoutEffect, useRef, useState } from 'react';

import Button, { whileRunning } from '@/components/ui/button';
import restoreFocusIfLost from '@/components/ui/focus-fallback';
import MarkdownField from '@/components/ui/markdown/markdown-field';
import ResultAlert from '@/components/ui/result-alert';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import AttachmentPicker, { type Attaching } from '../../_requests/attachment-picker';
import { mentionChoicesAction } from '../../_requests/mention-actions';
import { replyAction } from './actions';

/**
 * The form's buttons: send the reply, send it and wait for the company, or
 * send it as the solution, for the company to approve.
 */
type ReplyButton = 'send' | 'sendAndWait' | 'sendAsSolution';

/**
 * A text field with a button that sends the reply. For the staff, on a
 * request they can still put a question to, a second button sends it and
 * sets the request to wait for the company's answer, and a third sends it as
 * the solution, which makes the request wait for the company's approval
 * (decision 0033). After a reply is sent the field is empty again; a refused
 * one keeps what was typed. A button that goes once the request waits takes
 * focus with it: if it had focus, focus moves to the conversation's heading
 * instead of being lost. While a reply is sent, only the button that sent it
 * is busy, and the others are disabled (`whileRunning`). While people can
 * attach files, files go with the reply (`AttachmentPicker`), and the
 * buttons wait, still focusable, while one uploads.
 *
 * @param props - Form props.
 * @param props.request - The request's number.
 * @param props.canWait - Whether to offer "Send and wait for the company".
 * @param props.canPropose - Whether to offer "Send as solution".
 * @param props.attaching - What attaching needs, while people can attach files.
 */
export default function ReplyForm({
  request,
  canWait,
  canPropose = false,
  attaching = null,
}: {
  request: number;
  canWait: boolean;
  canPropose?: boolean;
  attaching?: Attaching | null;
}) {
  const t = useTranslations('requests.reply');
  const [result, formAction, pending, onSubmit] = useTransientActionState(replyAction, null);
  // The button that sent the reply running now (Send, also for a submit without a button).
  const [pressed, setPressed] = useState<ReplyButton>('send');
  const running = pending ? pressed : null;
  const send = whileRunning<ReplyButton>(running, 'send');
  const sendAndWait = whileRunning<ReplyButton>(running, 'sendAndWait');
  const sendAsSolution = whileRunning<ReplyButton>(running, 'sendAsSolution');
  const formRef = useRef<HTMLFormElement>(null);
  // Whether a file is uploading, which the reply waits for.
  const [uploading, setUploading] = useState(false);
  // Who the reply can mention: asked for when someone types "@".
  const loadMentions = useCallback(
    () => mentionChoicesAction({ request: String(request) }),
    [request],
  );
  // Whether "Send and wait for the company" and "Send as solution" were there at the last render.
  const couldWait = useRef(canWait);
  const couldPropose = useRef(canPropose);

  useLayoutEffect(() => {
    // A button just went (the request waits now): don't leave focus on <body>.
    if ((couldWait.current && !canWait) || (couldPropose.current && !canPropose)) {
      restoreFocusIfLost(formRef.current);
    }
    couldWait.current = canWait;
    couldPropose.current = canPropose;
  }, [canWait, canPropose]);

  /**
   * Notes which button sent the form, then sends it.
   *
   * @param event - The submit event.
   */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const { submitter } = event.nativeEvent as SubmitEvent;
    const status = submitter?.getAttribute('value');
    if (status === 'waiting') {
      setPressed('sendAndWait');
    } else if (status === 'proposed') {
      setPressed('sendAsSolution');
    } else {
      setPressed('send');
    }
    onSubmit(event);
  };

  return (
    <form ref={formRef} action={formAction} onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="request" value={request} />
      <ResultAlert result={result} />
      <MarkdownField
        label={t('label')}
        description={t('hint')}
        name="body"
        rows={8}
        maxLength={REQUEST_TEXT_MAX_LENGTH}
        required
        mentions={loadMentions}
      />
      {attaching && (
        <AttachmentPicker maxFileMb={attaching.maxFileMb} onUploadingChange={setUploading} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={send.loading}
          disabled={send.disabled || uploading}
          focusableWhenDisabled={uploading}
        >
          {t('send')}
        </Button>
        {canWait && (
          <Button
            type="submit"
            variant="secondary"
            name="status"
            value="waiting"
            loading={sendAndWait.loading}
            disabled={sendAndWait.disabled || uploading}
            focusableWhenDisabled={uploading}
          >
            {t('sendAndWait')}
          </Button>
        )}
        {canPropose && (
          <Button
            type="submit"
            variant="secondary"
            name="status"
            value="proposed"
            loading={sendAsSolution.loading}
            disabled={sendAsSolution.disabled || uploading}
            focusableWhenDisabled={uploading}
          >
            {t('sendAsSolution')}
          </Button>
        )}
      </div>
    </form>
  );
}
