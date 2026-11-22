/**
 * @file The dialog that adds a request type, or edits one, on the Requests tab of Settings.
 * Its text comes from `admin.settings.requests.requestTypes`, which the page passes
 * through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import ActionDialog from '@/components/ui/action-dialog';
import SelectField from '@/components/ui/select-field';
import TextField from '@/components/ui/text-field';
import {
  REQUEST_TYPE_DESCRIPTION_MAX_LENGTH,
  REQUEST_TYPE_NAME_MAX_LENGTH,
} from '@/lib/input-rules';
import type { RequestPriority } from '@/lib/requests';

import { addRequestTypeAction, updateRequestTypeAction } from './actions';

/** A type as the dialog edits it. */
interface EditedType {
  /** Its key, which the form sends. */
  key: string;
  /** Its name. */
  name: string;
  /** What it's for. */
  description: string;
  /** The priority a new request of this type starts with. */
  startingPriority: RequestPriority;
}

/** Props for {@link RequestTypeDialog}. */
interface RequestTypeDialogProps {
  /** The type to edit; without one, the dialog adds a type. */
  type?: EditedType;
  /** The priorities to choose from, with their names, from least to most urgent. */
  priorities: readonly { value: RequestPriority; label: string }[];
}

/**
 * A button that opens a dialog with a type's name, what it's for and its
 * starting priority: "Add type" for a new one (starting at Normal), or
 * "Edit" (named with the type for screen readers) for one that's there. A
 * success is a toast; a refusal stays in the dialog, with what was typed.
 *
 * @param props - Component props.
 * @param props.type - The type to edit, if any.
 * @param props.priorities - The priorities to choose from.
 * @returns The button and dialog.
 */
export default function RequestTypeDialog({
  type = undefined,
  priorities,
}: RequestTypeDialogProps) {
  const t = useTranslations('admin.settings.requests.requestTypes');
  const fields = (
    <>
      <TextField
        label={t('nameLabel')}
        name="name"
        maxLength={REQUEST_TYPE_NAME_MAX_LENGTH}
        defaultValue={type?.name}
        autoComplete="off"
        required
      />
      <TextField
        label={t('descriptionLabel')}
        name="description"
        maxLength={REQUEST_TYPE_DESCRIPTION_MAX_LENGTH}
        defaultValue={type?.description}
        description={t('descriptionHint')}
        autoComplete="off"
        required
      />
      <SelectField
        label={t('priorityLabel')}
        name="startingPriority"
        options={priorities}
        defaultValue={type?.startingPriority ?? 'normal'}
      />
    </>
  );

  if (!type) {
    return (
      <ActionDialog
        action={addRequestTypeAction}
        triggerLabel={t('add')}
        title={t('addTitle')}
        description={t('addDescription')}
        confirmLabel={t('addConfirm')}
        tone="primary"
      >
        {fields}
      </ActionDialog>
    );
  }
  return (
    <ActionDialog
      action={updateRequestTypeAction}
      fields={{ type: type.key }}
      triggerLabel={t('edit')}
      triggerAriaLabel={t('editLabel', { name: type.name })}
      title={t('editTitle', { name: type.name })}
      description={t('editDescription')}
      confirmLabel={t('save')}
      tone="primary"
    >
      {fields}
    </ActionDialog>
  );
}
