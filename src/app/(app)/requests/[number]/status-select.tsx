/**
 * @file The staff's status select on a request's page, which saves when a
 * status is picked. Its text comes from `requests.controls`, which the page
 * passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import SelectField, { type SelectOption } from '@/components/ui/select-field';
import Spinner from '@/components/ui/spinner';
import useSaveOnPick from '@/components/ui/use-save-on-pick';

import { changeStatusAction } from './actions';

/**
 * A status select that saves when a status is picked (`useSaveOnPick`), like
 * the role select of a member. It only commits on Enter, Space or click, so moving through
 * the statuses with the arrow keys never saves one by accident. It stays
 * mounted and focusable while saving (busy, not disabled), so keyboard focus
 * stays on it; the outcome is a toast, and a refusal is also shown under the
 * select, which goes back to the saved status.
 *
 * @param props - Select props.
 * @param props.request - The request's number.
 * @param props.status - Its saved status.
 * @param props.options - The statuses to choose from, named for the staff.
 * @returns The form.
 */
export default function StatusSelect({
  request,
  status,
  options,
}: {
  request: number;
  status: string;
  options: readonly SelectOption[];
}) {
  const t = useTranslations('requests.controls');
  const { formRef, formAction, onSubmit, result, pending, shown, pick, save } = useSaveOnPick(
    changeStatusAction,
    { name: 'status', saved: status },
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      className="flex w-full flex-col gap-1"
    >
      <input type="hidden" name="request" value={request} />
      {/* The status the page showed: the change is refused when a colleague changed it first. */}
      <input type="hidden" name="from" value={status} />
      <div className="flex items-center gap-2">
        {/* As wide as its place; the longest status wraps rather than being cut off. */}
        <div className="min-w-0 flex-1">
          <SelectField
            label={t('status')}
            hideLabel
            name="status"
            options={options}
            value={shown}
            busy={pending}
            onValueChange={(next) => {
              if (next === shown) {
                return;
              }
              pick(next);
              save(next);
            }}
            className="h-auto min-h-9 py-1.5"
          />
        </div>
        {pending && (
          <>
            <Spinner className="text-muted-foreground" />
            <span className="sr-only" role="status">
              {t('saving')}
            </span>
          </>
        )}
      </div>
      {result && !result.ok && (
        <span role="alert" className="max-w-56 text-xs font-medium text-danger">
          {result.message}
        </span>
      )}
    </form>
  );
}
