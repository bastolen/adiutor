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
import { REQUEST_PRIORITIES, type RequestPriority } from '@/lib/requests';

import { updateDetailsAction } from './actions';

/** A request's details as the dialog starts with them. */
interface Details {
  /** The title. */
  title: string;
  /** The type's key. */
  type: string;
  /** The priority. */
  priority: RequestPriority;
}

/** A type the request can be given, with the priority a request of it starts with. */
export interface EditableType {
  /** Its key. */
  key: string;
  /** Its name. */
  name: string;
  /** The priority a request of this type starts with. */
  startingPriority: RequestPriority;
}

/**
 * The dialog's fields. Picking another type moves the priority to that
 * type's own, as raising a request of that type would, until a priority is
 * picked by hand; what's saved is what the fields show.
 *
 * The values the fields started from go with them (`was_title`, `was_type`,
 * `was_priority`), so only what the editor changed is saved: a detail they
 * left alone keeps what a colleague gave it since this page was loaded.
 * They're the details the dialog opened with, kept while it's open, also
 * when the page behind it is refreshed: the fields don't follow a refresh
 * either, and the two have to stay what the editor saw.
 *
 * @param props - Component props.
 * @param props.details - The request's details as they are.
 * @param props.types - The types to choose from: the active ones, and the request's own.
 */
function DetailsFields({ details, types }: { details: Details; types: readonly EditableType[] }) {
  const t = useTranslations('requests');
  const [started] = useState(details);
  const [type, setType] = useState<string>(started.type);
  const [priority, setPriority] = useState<string>(started.priority);
  const [priorityPicked, setPriorityPicked] = useState(false);

  return (
    <>
      <input type="hidden" name="was_title" value={started.title} />
      <input type="hidden" name="was_type" value={started.type} />
      <input type="hidden" name="was_priority" value={started.priority} />
      <TextField
        label={t('controls.titleLabel')}
        name="title"
        maxLength={REQUEST_TITLE_MAX_LENGTH}
        defaultValue={started.title}
        autoComplete="off"
        required
      />
      <SelectField
        label={t('controls.typeLabel')}
        name="type"
        options={types.map(({ key, name }) => ({ value: key, label: name }))}
        value={type}
        onValueChange={(next) => {
          setType(next);
          const picked = types.find(({ key }) => key === next);
          if (!priorityPicked && picked) {
            setPriority(picked.startingPriority);
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
 * priority. Each change shows in the request's history. When a colleague
 * changed the same detail meanwhile, the dialog says so and stays open; the
 * page behind it then shows the request as it is, which the dialog starts
 * from when it's opened again.
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @param props.details - Its details as they are.
 * @param props.types - The types to choose from: the active ones, and the request's own.
 */
export default function EditDetails({
  request,
  details,
  types,
}: {
  request: number;
  details: Details;
  types: readonly EditableType[];
}) {
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
      allowedWhileSignedInAs
    >
      <DetailsFields details={details} types={types} />
    </ActionDialog>
  );
}
