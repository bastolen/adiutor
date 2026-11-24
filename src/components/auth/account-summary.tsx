/**
 * @file The account a sign-in link from an email signs in to, as its
 * confirmation page shows it (`/auth/email-link`, `/auth/request-link`): its
 * avatar, name and email address, and whoever is signed in in that browser
 * instead, as the page names them.
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

/** Whoever is signed in in this browser, as a sign-in link's confirmation page names them. */
export interface SignedInAccount extends NamedAccount {
  /** Whether it's the account the link signs in to. */
  same: boolean;
}

/**
 * Checks whether two accounts have the same name (anyone can give themselves
 * someone else's), ignoring case and surrounding spaces, so the page can
 * point out that only the address tells them apart.
 *
 * @param first - One account.
 * @param second - The other.
 * @returns Whether both have a name, and it's the same.
 */
export function sameName(first: NamedAccount, second: NamedAccount): boolean {
  const name = first.name.trim().toLowerCase();
  return name !== '' && name === second.name.trim().toLowerCase();
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
