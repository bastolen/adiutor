/**
 * @file The first cell of a row in the staff and members tables: who the
 * person is, with what the narrower layouts move under their name.
 */
import type { ReactNode } from 'react';

import Avatar from '@/components/ui/avatar';
import { ownRowCell, Td } from '@/components/ui/table';
import TextLink from '@/components/ui/text-link';

import { ActivityLine } from './activity';
import YouBadge from './you-badge';

/**
 * Props for {@link PersonCell}.
 */
interface PersonCellProps {
  /** The name to show (`displayName`), which is the address when they have no name. */
  name: string;
  /** Their email address. */
  email: string;
  /** Whether this is the signed-in user's own row: it gets the "You" badge and the row marker. */
  isSelf: boolean;
  /** Whether the avatar uses the brand colours (staff). */
  brand?: boolean;
  /** Their picture's address, or `null` for their initials. */
  picture?: string | null;
  /** Where the name links to, if anywhere (e.g. the user's page). */
  href?: string;
  /** Badges after the name and "You", e.g. "Deactivated". */
  badges?: ReactNode;
  /** The role (a select or a badge), shown here below 768px, where it has no column. */
  role: ReactNode;
  /** When they were last active, shown here below 1280px, where it has no column. */
  lastActiveAt: Date | null;
  /** When they joined. */
  joinedAt: Date;
}

/**
 * A table cell with the person's avatar, name (a link with `href`), "You" on
 * their own row, any other badges, and their address unless it is the name.
 * Below 768px the role follows, and below 1280px their activity, where the
 * table has no column for them. Long names and addresses break anywhere.
 */
export default function PersonCell({
  name,
  email,
  isSelf,
  brand = false,
  picture = null,
  href = undefined,
  badges = null,
  role,
  lastActiveAt,
  joinedAt,
}: PersonCellProps) {
  return (
    <Td className={isSelf ? ownRowCell : undefined}>
      <div className="flex items-center gap-3">
        <Avatar name={name} size="sm" brand={brand} src={picture} />
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {href ? (
              <TextLink standalone href={href} className="font-medium wrap-anywhere">
                {name}
              </TextLink>
            ) : (
              <span className="font-medium wrap-anywhere">{name}</span>
            )}
            {isSelf && <YouBadge />}
            {badges}
          </span>
          {name !== email && (
            <span className="text-xs wrap-anywhere text-muted-foreground">{email}</span>
          )}
          <div className="mt-2 md:hidden">{role}</div>
          <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground xl:hidden">
            <ActivityLine lastActiveAt={lastActiveAt} joinedAt={joinedAt} />
          </span>
        </div>
      </div>
    </Td>
  );
}
