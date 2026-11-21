/**
 * @file The staff's "Change assignees" dialog on a request's page: a
 * checkbox for every staff member who works on requests, the current
 * assignees ticked. Its text comes from the `requests` namespace, which the
 * page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import CheckboxField from '@/components/ui/checkbox-field';

import { changeAssigneesAction } from './actions';

/** A staff member the dialog offers to assign. */
export interface AssigneeChoice {
  /** Their user ID. */
  id: string;
  /** Their name, or `null` when it has nothing to see. */
  name: string | null;
  /** Whether they're the one changing the assignees. */
  isViewer: boolean;
}

/**
 * The dialog's checkboxes: the viewer first, then everyone else in the order
 * given (by name). Who was assigned when the dialog opened goes with them
 * (`was_assignee`), so only what the editor changed is saved: someone a
 * colleague assigned or removed since this page loaded, whom the editor left
 * alone, stays as the colleague left them. Both are kept while the dialog is
 * open, also when the page behind it is refreshed: the checkboxes don't
 * follow a refresh either, and the two have to stay what the editor saw.
 *
 * @param props - Component props.
 * @param props.choices - The staff members to offer.
 * @param props.assigned - The user IDs of those assigned now.
 * @returns The fields.
 */
function AssigneeFields({
  choices,
  assigned,
}: {
  choices: readonly AssigneeChoice[];
  assigned: readonly string[];
}) {
  const t = useTranslations('requests.controls');
  const [started] = useState(() => ({
    // A stable sort: the viewer first, the rest as they came.
    choices: [...choices].sort((a, b) => Number(b.isViewer) - Number(a.isViewer)),
    assigned,
  }));
  /**
   * The label of one staff member's checkbox.
   *
   * @param choice - The staff member.
   * @returns Their name, marked when it's the viewer's.
   */
  const labelOf = (choice: AssigneeChoice) => {
    const name = choice.name ?? t('unnamedStaff');
    return choice.isViewer ? t('assigneeYou', { name }) : name;
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium text-foreground">{t('assigneesLabel')}</legend>
      {started.assigned.map((id) => (
        <input key={id} type="hidden" name="was_assignee" value={id} />
      ))}
      {started.choices.map((choice) => (
        <CheckboxField
          key={choice.id}
          name="assignee"
          value={choice.id}
          label={labelOf(choice)}
          defaultChecked={started.assigned.includes(choice.id)}
        />
      ))}
    </fieldset>
  );
}

/**
 * A button that opens a dialog to change who a request is assigned to, with
 * a checkbox for every staff member who works on requests. Each person
 * assigned or removed shows in the request's history, which the company
 * reads too.
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @param props.choices - The staff members who can be assigned, and anyone assigned now.
 * @param props.assigned - The user IDs of those assigned now.
 * @returns The button and dialog.
 */
export default function ChangeAssignees({
  request,
  choices,
  assigned,
}: {
  request: number;
  choices: readonly AssigneeChoice[];
  assigned: readonly string[];
}) {
  const t = useTranslations('requests.controls');
  return (
    <ActionDialog
      action={changeAssigneesAction}
      fields={{ request: String(request) }}
      triggerLabel={t('changeAssignees')}
      title={t('assigneesTitle')}
      description={t('assigneesDescription')}
      confirmLabel={t('saveAssignees')}
      tone="primary"
      allowedWhileSignedInAs
    >
      <AssigneeFields choices={choices} assigned={assigned} />
    </ActionDialog>
  );
}
