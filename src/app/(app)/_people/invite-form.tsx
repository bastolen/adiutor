/**
 * @file Form to invite one or more people by email, to a company or staff.
 * Text from the `people` namespace, which the page passes with
 * `ClientMessages`.
 */
'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef } from 'react';

import { ConfirmFirstNote, ReturnToField } from '@/components/auth/recent-confirmation';
import EmailLanguageField from '@/components/language/email-language-field';
import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import SelectField, { type SelectOption } from '@/components/ui/select-field';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextAreaField from '@/components/ui/textarea-field';
import { useTransientActionState, useTransientState } from '@/components/ui/use-transient-state';
import { MAX_BULK_INVITES } from '@/lib/input-rules';

import { inviteAction } from './invitation-actions';
import { hiddenTag } from './rich-tags';
import useConfirmBeforeGrant from './use-confirm-before-grant';

/**
 * Props for {@link InviteForm}.
 */
interface InviteFormProps {
  /** The company to invite to, or `null` for staff. */
  companyId: string | null;
  /** Roles that can be given, named in the reader's language. */
  roles: readonly SelectOption[];
}

/**
 * Email addresses (one or more) and a role, with a send button. After
 * sending several, a line per address says what happened. The confirmation
 * for an address stays the same whether or not it has an account, unless the
 * user is staff.
 *
 * Inviting staff, or a company's Admin, needs a recent confirmation: while
 * the user doesn't have one, a note with a link to confirm replaces the send
 * button as soon as such a role is chosen, so nothing typed is lost.
 *
 * A refused send keeps the list as typed (one bad address refuses them all).
 * When some invitations went out and others didn't, the list is refilled
 * with just the addresses that weren't sent; when all went out, it clears.
 */
export default function InviteForm({ companyId, roles }: InviteFormProps) {
  const t = useTranslations('people');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(inviteAction, null);
  const lines = result?.ok ? (result.data?.lines ?? []) : [];
  const emailsRef = useRef<HTMLTextAreaElement>(null);
  const [role, setRole] = useTransientState(roles.at(-1)?.value ?? '');
  const confirmFirst = useConfirmBeforeGrant(companyId, role);

  // After the hook cleared the sent form: put back the addresses that weren't sent.
  useLayoutEffect(() => {
    const unsent = result?.ok ? (result.data?.lines ?? []).filter((line) => !line.ok) : [];
    if (unsent.length > 0 && emailsRef.current) {
      emailsRef.current.value = unsent.map((line) => line.email).join('\n');
    }
  }, [result]);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        {/* Empty means the staff. */}
        <input type="hidden" name="companyId" value={companyId ?? ''} />
        {/* The page and card to come back to, if the action sends the user to confirm first. */}
        <ReturnToField />
        <ResultAlert result={result} />
        {lines.length > 0 && (
          <ul aria-label={t('inviteForm.results')} className="flex flex-col gap-1.5 text-sm">
            {lines.map((line) => (
              <li
                key={line.email}
                className={line.ok ? 'flex gap-2 text-foreground' : 'flex gap-2 text-danger'}
              >
                {line.ok ? (
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                )}
                <span>
                  {line.ok
                    ? t.rich('inviteForm.sentLine', { hidden: hiddenTag, message: line.message })
                    : t.rich('inviteForm.notSentLine', {
                        hidden: hiddenTag,
                        email: line.email,
                        message: line.message,
                      })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
          <TextAreaField
            ref={emailsRef}
            label={t('inviteForm.emails')}
            name="emails"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('inviteForm.emailsPlaceholder')}
            description={t('inviteForm.emailsHint', { max: MAX_BULK_INVITES })}
            required
            disabled={changesOff}
          />
          <div className="flex flex-col gap-4">
            <SelectField
              label={t('inviteForm.role')}
              name="role"
              options={roles}
              value={role}
              onValueChange={setRole}
              disabled={changesOff}
            />
            <EmailLanguageField purpose="invitation" disabled={changesOff} />
          </div>
        </div>
        {confirmFirst ? (
          <ConfirmFirstNote>{t('confirmBeforeGrant')}</ConfirmFirstNote>
        ) : (
          <div>
            <Button type="submit" loading={pending} disabled={changesOff}>
              {t('inviteForm.submit')}
            </Button>
          </div>
        )}
      </ChangesFieldset>
    </form>
  );
}
