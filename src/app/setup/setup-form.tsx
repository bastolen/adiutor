/**
 * @file First-run form: the staff name and its first Admin.
 */
'use client';

import Button from '@/components/ui/button';
import ResultAlert from '@/components/ui/result-alert';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH } from '@/lib/input-rules';

import setupAction from './actions';

/**
 * Name shown to users, name, email and password, with a button that sets
 * everything up and signs in.
 *
 * @returns The form.
 */
export default function SetupForm() {
  const [result, formAction, pending, onSubmit] = useTransientActionState(setupAction, null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ResultAlert result={result} errorsOnly />
      <TextField
        label="Name shown to users"
        name="staffName"
        maxLength={NAME_MAX_LENGTH}
        autoComplete="organization"
        placeholder="Adiutor"
        description="Used in invitations and wherever users see who's helping them. You can change it later."
        required
      />
      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        required
        maxLength={NAME_MAX_LENGTH}
      />
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@adiutor.dev"
        required
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        description={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        required
      />
      <Button type="submit" fullWidth loading={pending}>
        Set up Adiutor
      </Button>
    </form>
  );
}
