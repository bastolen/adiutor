/**
 * @file The "Change subscribers" dialog on a request's page, for the staff
 * who work on requests and for the company's Admins: a checkbox for everyone
 * whose subscription the viewer may change, the subscribers ticked. Its text
 * comes from the `requests` namespace, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import CheckboxField from '@/components/ui/checkbox-field';
import type { SubscribablePerson } from '@/server/requests';

import { changeSubscribersAction } from './actions';

/**
 * Someone the dialog offers to subscribe: their name, the key that stands
 * for them (never a user ID), whether they're listed with the staff (nobody
 * is, for a company's Admin), whether they're subscribed now and whether
 * they're the one changing the subscribers.
 */
export type SubscriberChoice = SubscribablePerson;

/**
 * The dialog's checkboxes: the people at the request's company, then the
 * staff, each group by name as it came. Who was subscribed when the dialog
 * opened goes with them (`was_subscriber`), so only what the editor changed
 * is saved. Both are kept while the dialog is open, also when the page
 * behind it is refreshed: the checkboxes don't follow a refresh either, and
 * the two have to stay what the editor saw.
 *
 * @param props - Component props.
 * @param props.choices - The people to offer.
 * @param props.company - The name of the request's company.
 * @returns The fields.
 */
function SubscriberFields({
  choices,
  company,
}: {
  choices: readonly SubscriberChoice[];
  company: string;
}) {
  const t = useTranslations('requests.controls');
  const [started] = useState(choices);
  const groups = [
    { id: 'company', legend: t('subscribersCompany', { company }), staff: false },
    { id: 'staff', legend: t('subscribersStaff'), staff: true },
  ]
    .map((group) => ({
      ...group,
      people: started.filter(({ staff }) => staff === group.staff),
    }))
    .filter(({ people }) => people.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {started
        .filter(({ subscribed }) => subscribed)
        .map(({ key }) => (
          <input key={key} type="hidden" name="was_subscriber" value={key} />
        ))}
      {groups.map(({ id, legend, people }) => (
        <fieldset key={id} className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium text-foreground">{legend}</legend>
          {people.map((choice) => (
            <CheckboxField
              key={choice.key}
              name="subscriber"
              value={choice.key}
              label={choice.isViewer ? t('personYou', { name: choice.name }) : choice.name}
              defaultChecked={choice.subscribed}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/**
 * A button that opens a dialog to change who is subscribed to a request,
 * with a checkbox for everyone whose subscription the viewer may change:
 * anyone who reads the request for the staff, their colleagues for a
 * company's Admin. Subscribing leaves nothing in the request's history.
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @param props.choices - The people who can be subscribed, with who is now.
 * @param props.company - The name of the request's company.
 * @param props.scope - Whose subscriptions the viewer changes: `everyone` (the staff) or
 *   `colleagues` (a company's Admin); it words the explanation.
 * @returns The button and dialog.
 */
export default function ChangeSubscribers({
  request,
  choices,
  company,
  scope,
}: {
  request: number;
  choices: readonly SubscriberChoice[];
  company: string;
  scope: 'everyone' | 'colleagues';
}) {
  const t = useTranslations('requests.controls');
  return (
    <ActionDialog
      action={changeSubscribersAction}
      fields={{ request: String(request) }}
      triggerLabel={t('changeSubscribers')}
      title={t('subscribersTitle')}
      description={t('subscribersDescription', { scope })}
      confirmLabel={t('saveSubscribers')}
      tone="primary"
      allowedWhileSignedInAs
    >
      <SubscriberFields choices={choices} company={company} />
    </ActionDialog>
  );
}
