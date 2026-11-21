/**
 * @file The account a sign-in link from an email signs in to, as its
 * confirmation page shows it (`/auth/email-link`, `/auth/request-link`): its
 * avatar, name and email address.
 */
import Avatar from '@/components/ui/avatar';
import displayName from '@/lib/display-name';

/** An account as a page names it. */
export interface NamedAccount {
  /** The account's name; may be empty. */
  name: string;
  /** Its email address, in full (the part that tells accounts apart: names can be copied). */
  email: string;
}

/**
 * Names an account in running text: its name with the address, or just the
 * address when it has no name.
 *
 * @param account - The account.
 * @param account.name - Its name; may be empty.
 * @param account.email - Its address.
 * @returns E.g. "Jane Doe (jane@adiutor.dev)".
 */
export function accountLabel({ name, email }: NamedAccount): string {
  return name ? `${name} (${email})` : email;
}

/**
 * A bordered row with the account's avatar, name and address. Both wrap
 * instead of being cut off, so a long address always shows its domain.
 *
 * @param props - The account.
 * @param props.name - Its name; left out when empty.
 * @param props.email - Its address.
 * @returns The row.
 */
export default function AccountSummary({ name, email }: NamedAccount) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
      <Avatar name={displayName({ name, email })} />
      <div className="flex min-w-0 flex-col">
        {name && <span className="text-sm font-medium wrap-anywhere text-foreground">{name}</span>}
        <span className="text-sm break-all text-muted-foreground">{email}</span>
      </div>
    </div>
  );
}
