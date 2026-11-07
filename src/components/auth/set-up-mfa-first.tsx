/**
 * @file Shown instead of the Accept or Join button when the signed-in user's
 * role requires MFA they haven't set up yet (e.g. they're Admin of another
 * company): accepting would only send them to set it up and lose the step.
 */
import Link from 'next/link';

import Alert from '@/components/ui/alert';
import Button from '@/components/ui/button';

/**
 * Explains that MFA comes first, with a way to set it up.
 *
 * @returns The explanation.
 */
export default function SetUpMfaFirst() {
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">
        Your role requires MFA before you can continue. Add a passkey or set up an authenticator
        app, then open this link again: it still works.
      </Alert>
      <Button fullWidth asChild>
        <Link href="/account/security">Set up MFA</Link>
      </Button>
    </div>
  );
}
