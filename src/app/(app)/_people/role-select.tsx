/**
 * @file Role menu for one person (a company member or a staff member),
 * saving when a new role is picked, or after a confirmation on the user's
 * own row.
 */
'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import { ReturnToField, useRecentConfirmation } from '@/components/auth/recent-confirmation';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import SelectField, { type SelectOption } from '@/components/ui/select-field';
import { useSignedInAs } from '@/components/ui/signed-in-as';
import Spinner from '@/components/ui/spinner';
import useSaveOnPick from '@/components/ui/use-save-on-pick';
import { useTransientState } from '@/components/ui/use-transient-state';
import type { ActionResult } from '@/lib/action-result';
import { grantNeedsConfirmation } from '@/lib/authz/guards';
import { isRole } from '@/lib/authz/roles';

/**
 * The question to ask before saving a change to the user's own role, already
 * in the reader's language.
 */
export interface RoleChangeConfirmation {
  /**
   * The question for each role that can be picked, by role ID, e.g.
   * `{ manager: 'Step down to Manager?' }`: the page words each one as a
   * whole sentence with the role's name in it.
   */
  titles: Readonly<Record<string, string>>;
  /** What will happen. */
  description: string;
  /** Text of the confirming button, e.g. "Step down". */
  confirmLabel: string;
}

/**
 * Props for {@link RoleSelect}.
 */
interface RoleSelectProps {
  /** The server action that saves the role (receives `fields` and `role`). */
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  /** Hidden fields identifying the person, e.g. `{ companyId, membershipId }`. */
  fields: Record<string, string>;
  /** The member's name, for the accessible label. */
  memberName: string;
  /** Their current role. */
  currentRole: string;
  /** Roles that can be given. */
  roles: readonly SelectOption[];
  /**
   * Ask before saving (for the user's own row, where stepping down can take
   * away the page and can't be undone by themselves). Without it, a picked
   * role is saved at once.
   */
  confirmChange?: RoleChangeConfirmation;
  /**
   * Whether these are staff roles or a company's roles. Picking a role that
   * needs a recent confirmation (making someone staff, a higher staff role,
   * or a company's Admin) sends the user to confirm it's them first, when
   * they haven't lately; nothing is saved.
   */
  target: 'staff' | 'company';
}

/**
 * A role select that saves when a role is picked (`useSaveOnPick`). The select only commits on
 * Enter, Space or click, so moving through the options with the arrow keys
 * never saves by accident. The outcome is shown and announced; after an error
 * (e.g. removing the last admin) the select goes back to the saved role. It
 * stays mounted and focusable throughout (busy, not disabled, while saving),
 * so keyboard focus stays on it. In the signed-in app the outcome is a toast
 * (a refusal is also shown next to the select).
 *
 * A role that needs a recent confirmation the user doesn't have (see
 * `target`) sends them to confirm it's them first (`useRecentConfirmation`);
 * the select stays on the saved role.
 *
 * With `confirmChange`, picking a role opens a confirmation dialog instead:
 * confirming saves the picked role, cancelling (or Escape) puts the select
 * back and returns focus to it. Leaving the page cancels it too.
 *
 * Its own text comes from the `people` namespace: the page passes it with
 * `ClientMessages`.
 *
 * @param props - Select props.
 * @param props.action - The saving server action.
 * @param props.fields - Hidden fields.
 * @param props.memberName - The member's name.
 * @param props.currentRole - Current role.
 * @param props.roles - Roles to choose from.
 * @param props.confirmChange - The question to ask before saving, if any.
 * @param props.target - Staff or company roles, for the recent confirmation some need.
 * @returns The form.
 */
export default function RoleSelect({
  action,
  fields,
  memberName,
  currentRole,
  roles,
  confirmChange = undefined,
  target,
}: RoleSelectProps) {
  const t = useTranslations('people.roleSelect');
  // Roles don't change while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const { askToConfirm } = useRecentConfirmation();
  const {
    formRef,
    formAction,
    onSubmit,
    result,
    pending,
    showsToast,
    shown,
    picked,
    pick,
    unpick,
    save,
  } = useSaveOnPick(action, { name: 'role', saved: currentRole });
  const [confirming, setConfirming] = useTransientState(false);
  // Set by "Confirm", so the dialog closing after it doesn't count as cancelling.
  const confirmedRef = useRef(false);

  /**
   * Opens or closes the dialog; closing without confirming puts the select back.
   *
   * @param open - Whether it's open now.
   */
  const changeConfirming = (open: boolean) => {
    setConfirming(open);
    if (!open && !confirmedRef.current) {
      unpick();
    }
    confirmedRef.current = false;
  };

  /**
   * Returns focus to the select, which there's no trigger for the dialog to return it to.
   *
   * @param event - The dialog's close event.
   */
  const focusSelect = (event: Event) => {
    event.preventDefault();
    formRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
  };

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      <div className="flex items-center gap-2">
        <div className="w-36">
          <SelectField
            label={t('label', { name: memberName })}
            hideLabel
            name="role"
            options={roles}
            value={shown}
            busy={pending}
            disabled={changesOff}
            onValueChange={(role) => {
              // A raise that needs a recent confirmation: confirm first, save nothing.
              if (
                isRole(role) &&
                grantNeedsConfirmation({
                  target: { type: target },
                  role,
                  from: isRole(currentRole) ? currentRole : null,
                }) &&
                askToConfirm()
              ) {
                return;
              }
              pick(role);
              if (confirmChange) {
                // On the next frame: opened while Enter is still being handled, the dialog would
                // take focus before the key press ends, and the browser would press "Cancel".
                requestAnimationFrame(() => setConfirming(true));
                return;
              }
              save(role);
            }}
            className="h-9"
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
      {result?.ok && !pending && !showsToast && (
        <span role="status" className="text-xs text-success">
          {result.message}
        </span>
      )}
      {confirmChange && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={changeConfirming}
          onCloseAutoFocus={focusSelect}
          title={(picked === null ? undefined : confirmChange.titles[picked]) ?? ''}
          description={confirmChange.description}
          confirmLabel={confirmChange.confirmLabel}
          onConfirm={() => {
            confirmedRef.current = true;
            if (picked !== null) {
              save(picked);
            }
          }}
        />
      )}
    </form>
  );
}
