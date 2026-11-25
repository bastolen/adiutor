/**
 * @file The banner's "Back to my account" button while signed in as a user.
 */
'use client';

import { Undo2 } from 'lucide-react';

import Button from '@/components/ui/button';

import useBackToOwnAccount from './use-back-to-own-account';

/**
 * Ends signing in as the user and goes back to where the staff member
 * started (`useBackToOwnAccount`), busy while it runs.
 *
 * @param props - Component props.
 * @param props.label - The button's text, e.g. "Back to my account".
 */
export default function BackToOwnAccountButton({ label }: { label: string }) {
  const { goBack, pending } = useBackToOwnAccount();
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={goBack}>
      <Undo2 aria-hidden="true" />
      {label}
    </Button>
  );
}
