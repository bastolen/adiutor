/**
 * @file Form to choose the user's picture, on the account's Profile page: the
 * picture of one of their connected GitHub or Google accounts, or their
 * initials. Its text comes from the `account` namespace.
 */
'use client';

import { useTranslations } from 'next-intl';

import { securityLink } from '@/components/auth/security-links';
import Avatar from '@/components/ui/avatar';
import Button from '@/components/ui/button';
import RadioField from '@/components/ui/radio-field';
import ResultAlert from '@/components/ui/result-alert';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { type OAuthProvider, PROVIDER_LABELS } from '@/lib/sign-in/oauth-providers';
import type { AvatarSource } from '@/lib/sign-in/pictures';

import { savePictureAction } from './actions';

/** One connected account whose picture can be chosen. */
export interface PictureOption {
  /** Its provider. */
  providerId: OAuthProvider;
  /** Its name at the provider (a GitHub username), when it's known. */
  accountName: string | null;
  /** Its picture's address in Adiutor, or `null` while it has none yet. */
  picture: string | null;
}

/** Props for {@link PictureForm}. */
interface PictureFormProps {
  /** The user's name, for the initials in the previews. */
  name: string;
  /** The connected accounts whose picture can be chosen, each provider once. */
  options: readonly PictureOption[];
  /** What the user shows now: by their choice, or by default until they choose. */
  shown: AvatarSource;
  /** Whether they chose; until then the default applies, and the form says so. */
  chosen: boolean;
}

/**
 * A choice of picture, each option with its preview, and a save button. An
 * account without a picture yet (connected before pictures were kept) is
 * offered disabled, with what gives it one. Without any connected account,
 * only the initials are offered, with where to connect one. The choice
 * stays as saved after saving (`resetOnSuccess: false`), and the page shows
 * the new picture wherever the user appears.
 *
 * @param props - Component props.
 * @param props.name - The user's name.
 * @param props.options - The accounts whose picture can be chosen.
 * @param props.shown - What the user shows now.
 * @param props.chosen - Whether they chose.
 * @returns The form.
 */
export default function PictureForm({ name, options, shown, chosen }: PictureFormProps) {
  const t = useTranslations('account');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(savePictureAction, null, {
    resetOnSuccess: false,
  });

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <ChangesFieldset>
        <ResultAlert result={result} />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium text-foreground">
            {t('profile.pictureLabel')}
          </legend>
          {options.map(({ providerId, accountName, picture }) => (
            <RadioField
              key={providerId}
              name="picture"
              value={providerId}
              label={t('profile.pictureProvider', {
                provider: PROVIDER_LABELS[providerId],
                hasAccount: accountName ? 'yes' : 'no',
                account: accountName ?? '',
              })}
              description={
                picture ? '' : t('profile.pictureNotYet', { provider: PROVIDER_LABELS[providerId] })
              }
              leading={<Avatar name={name} size="sm" src={picture} />}
              defaultChecked={shown === providerId}
              disabled={changesOff || !picture}
            />
          ))}
          <RadioField
            name="picture"
            value="initials"
            label={t('profile.pictureInitials')}
            leading={<Avatar name={name} size="sm" />}
            defaultChecked={shown === 'initials'}
            disabled={changesOff}
          />
        </fieldset>
        {!chosen && options.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('profile.pictureDefault', { shown: shown === 'initials' ? 'initials' : 'picture' })}
          </p>
        )}
        {options.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t.rich('profile.pictureConnect', { link: securityLink })}
          </p>
        )}
        <div>
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('profile.savePicture')}
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
