/**
 * @file The staff's "Edit details" dialog on a request's page: its title,
 * type and priority. Its text comes from the `requests` namespace, which the
 * page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import ActionDialog from '@/components/ui/action-dialog';
import SelectField from '@/components/ui/select-field';
import TextField from '@/components/ui/text-field';
import { REQUEST_TITLE_MAX_LENGTH } from '@/lib/input-rules';
import {
  isRequestType,
  REQUEST_PRIORITIES,
  REQUEST_TYPES,
  type RequestPriority,
  type RequestType,
  startingPriority,
} from '@/lib/requests';

import { updateDetailsAction } from './actions';

/** A request's details as the dialog starts with them. */
interface Details {
  /** The title. */
  title: string;
  /** The type. */
  type: RequestType;
  /** The priority. */
  priority: RequestPriority;
}

/**
 * The dialog's fields. Picking another type moves the priority to that
 * type's own, as raising a request of that type would, until a priority is
 * picked by hand; what's saved is what the fields show.
 *
 * @param props - Component props.
 * @param props.details - The request's details as they are.
 * @returns The fields.
 */
function DetailsFields({ details }: { details: Details }) {
  const t = useTranslations('requests');
  const [type, setType] = useState<string>(details.type);
  const [priority, setPriority] = useState<string>(details.priority);
  const [priorityPicked, setPriorityPicked] = useState(false);

  return (
    <>
      <TextField
        label={t('controls.titleLabel')}
        name="title"
        maxLength={REQUEST_TITLE_MAX_LENGTH}
        defaultValue={details.title}
        autoComplete="off"
        required
      />
      <SelectField
        label={t('controls.typeLabel')}
        name="type"
        options={REQUEST_TYPES.map((value) => ({ value, label: t('type', { type: value }) }))}
        value={type}
        onValueChange={(next) => {
          setType(next);
          if (!priorityPicked && isRequestType(next)) {
            setPriority(startingPriority(next));
          }
        }}
      />
      <SelectField
        label={t('controls.priorityLabel')}
        name="priority"
        options={REQUEST_PRIORITIES.map((value) => ({
          value,
          label: t('priority', { priority: value }),
        }))}
        value={priority}
        onValueChange={(next) => {
          setPriority(next);
          setPriorityPicked(true);
        }}
        description={t('controls.priorityHint')}
      />
    </>
  );
}

/**
 * A button that opens a dialog to change a request's title, type and
 * priority. Each change shows in the request's history.
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @param props.details - Its details as they are.
 * @returns The button and dialog.
 */
export default function EditDetails({ request, details }: { request: number; details: Details }) {
  const t = useTranslations('requests.controls');
  return (
    <ActionDialog
      action={updateDetailsAction}
      fields={{ request: String(request) }}
      triggerLabel={t('editDetails')}
      title={t('editTitle')}
      description={t('editDescription')}
      confirmLabel={t('saveDetails')}
      tone="primary"
    >
      <DetailsFields details={details} />
    </ActionDialog>
  );
}
