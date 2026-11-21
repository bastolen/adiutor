/**
 * @file The notice above the reply form while a request waits for the
 * company to approve the solution the staff sent (decision 0033), with the
 * buttons that answer it. Its text comes from `requests.solution`.
 */
import { useTranslations } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';
import MarkdownField from '@/components/ui/markdown/markdown-field';
import RowAction from '@/components/ui/row-action';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import { answerSolutionAction } from './actions';

/**
 * A notice that the staff proposed a solution, asking whether it solves the
 * request, for the company's Admins and Clients (`mayAnswerSolution`).
 * **Approve** closes the request at once; **Deny** opens a dialog with an
 * optional "What's still wrong?" field, saved as their reply, and puts the
 * request back with the staff. Both are the user's own work, so a staff
 * member signed in as them may answer too (decision 0028). When an answer
 * removes the notice, focus goes to the card's heading (`RowAction`,
 * `ActionDialog`).
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @returns The notice.
 */
export default function SolutionNotice({ request }: { request: number }) {
  const t = useTranslations('requests.solution');
  const fields = { request: String(request) };
  return (
    <section
      aria-labelledby="solution-notice-title"
      className="flex flex-col gap-3 rounded-lg bg-warning-soft p-4"
    >
      <h3 id="solution-notice-title" className="text-sm font-semibold text-foreground">
        {t('title')}
      </h3>
      <p className="text-sm text-foreground">{t('description')}</p>
      <div className="flex flex-wrap gap-2">
        <RowAction
          action={answerSolutionAction}
          allowedWhileSignedInAs
          fields={{ ...fields, answer: 'approve' }}
          label={t('approve')}
          variant="primary"
        />
        <ActionDialog
          action={answerSolutionAction}
          allowedWhileSignedInAs
          fields={{ ...fields, answer: 'deny' }}
          triggerLabel={t('deny')}
          triggerVariant="secondary"
          title={t('denyTitle')}
          description={t('denyDescription')}
          confirmLabel={t('denyConfirm')}
          tone="primary"
        >
          <MarkdownField
            label={t('reasonLabel')}
            name="body"
            rows={5}
            maxLength={REQUEST_TEXT_MAX_LENGTH}
          />
        </ActionDialog>
      </div>
    </section>
  );
}
