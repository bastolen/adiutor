/**
 * @file Form to create a single-use invite link, which is shown once.
 */
'use client';

import { ConfirmFirstNote, ReturnToField } from '@/components/auth/recent-confirmation';
import Button from '@/components/ui/button';
import CopyButton from '@/components/ui/copy-button';
import ResultAlert from '@/components/ui/result-alert';
import SelectField, { type SelectOption } from '@/components/ui/select-field';
import { fieldControl } from '@/components/ui/styles';
import { useTransientActionState, useTransientState } from '@/components/ui/use-transient-state';
import cn from '@/lib/cn';
import { daysLabel, INVITE_LINK_VALIDITY_DAYS } from '@/lib/invitation-lifetimes';

import { createInviteLinkAction } from './invitation-actions';
import useConfirmBeforeGrant, { CONFIRM_BEFORE_GRANT_NOTE } from './use-confirm-before-grant';

/** How long a link can stay valid, from the lifetimes the server accepts. */
const VALIDITY_OPTIONS: readonly SelectOption[] = INVITE_LINK_VALIDITY_DAYS.map((days) => ({
  value: String(days),
  label: daysLabel(days),
}));

/**
 * Props for {@link InviteLinkForm}.
 */
interface InviteLinkFormProps {
  /** The company the link is for, or `null` for staff. */
  companyId: string | null;
  /** Roles that can be given. */
  roles: readonly SelectOption[];
}

/**
 * Role and validity fields. After creating, shows the link in a read-only
 * field with a copy button; it can't be shown again later. A link for a
 * staff role, or a company's Admin role, needs a recent confirmation: while
 * the user doesn't have one, a note with a link to confirm replaces the
 * create button.
 *
 * @param props - Form props.
 * @param props.companyId - The company, or `null` for staff.
 * @param props.roles - Roles to choose from.
 * @returns The form.
 */
export default function InviteLinkForm({ companyId, roles }: InviteLinkFormProps) {
  const [result, formAction, pending, onSubmit] = useTransientActionState(
    createInviteLinkAction,
    null,
  );
  const url = result?.ok ? result.data?.url : undefined;
  const [role, setRole] = useTransientState(roles.at(-1)?.value ?? '');
  const confirmFirst = useConfirmBeforeGrant(companyId, role);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Empty means the staff. */}
      <input type="hidden" name="companyId" value={companyId ?? ''} />
      {/* The page and card to come back to, if the action sends the user to confirm first. */}
      <ReturnToField />
      <ResultAlert result={result} errorsOnly />
      {url && (
        <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success-soft p-4">
          <p role="status" className="text-sm font-medium text-success">
            Link created. Copy it now: for safety it won&apos;t be shown again. It works once.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Invite link"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className={cn(fieldControl, 'h-10 min-w-0 flex-1 font-mono text-xs')}
            />
            <CopyButton value={url} label="Copy link" />
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Role"
          name="role"
          options={roles}
          value={role}
          onValueChange={setRole}
        />
        <SelectField
          label="Valid for"
          name="validDays"
          options={VALIDITY_OPTIONS}
          defaultValue="7"
        />
      </div>
      {confirmFirst ? (
        <ConfirmFirstNote>{CONFIRM_BEFORE_GRANT_NOTE}</ConfirmFirstNote>
      ) : (
        <div>
          <Button type="submit" variant="secondary" loading={pending}>
            Create invite link
          </Button>
        </div>
      )}
    </form>
  );
}
