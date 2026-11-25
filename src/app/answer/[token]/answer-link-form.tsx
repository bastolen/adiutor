/**
 * @file The button (or buttons) on an answer link's page that answer the
 * solution, for a link opened without a person's click.
 */
'use client';

import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import Button, { whileRunning } from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import type { SolutionAnswer } from '@/lib/requests';

import { answerLinkAction } from './actions';

/**
 * Answers through the link: one button for the answer the email's button
 * stood for, or Approve and Deny when the page was opened without one. Only
 * the pressed button is busy (`whileRunning`); once it has answered, the
 * page shows what happened instead.
 *
 * @param props - Component props.
 * @param props.token - The link's token.
 * @param props.answers - The answers to offer, the main one first.
 */
export default function AnswerLinkForm({
  token,
  answers,
}: {
  token: string;
  answers: readonly SolutionAnswer[];
}) {
  const t = useTranslations('requests.answerLink');
  const [result, formAction, pending, onSubmit] = useTransientActionState(answerLinkAction, null);
  const [pressed, setPressed] = useState<SolutionAnswer | null>(null);
  const running = pending ? pressed : null;

  /**
   * Notes which button answered, then sends the form.
   *
   * @param event - The submit event.
   */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const { submitter } = event.nativeEvent as SubmitEvent;
    const value = submitter?.getAttribute('value');
    setPressed(answers.find((answer) => answer === value) ?? null);
    onSubmit(event);
  };

  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <ResultAlert result={result} errorsOnly />
      <div className="flex flex-col gap-3">
        {answers.map((answer, index) => {
          const state = whileRunning(running, answer);
          return (
            <Button
              key={answer}
              type="submit"
              name="answer"
              value={answer}
              variant={index === 0 ? 'primary' : 'secondary'}
              fullWidth
              loading={state.loading}
              disabled={state.disabled}
            >
              {t(answer)}
            </Button>
          );
        })}
      </div>
    </form>
  );
}
