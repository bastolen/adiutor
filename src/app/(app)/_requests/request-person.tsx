/**
 * @file Shows who raised, wrote or changed something in a request: their
 * name, a label with the staff's name on the staff's side, and "You" for the
 * reader. Never an email address: a company's Clients and Watchers can't see
 * who else is in it, beyond the names in its requests. For the staff, who
 * have a page for every user, the name links to it.
 */
import type { ReactNode } from 'react';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import TextLink from '@/components/ui/text-link';
import type { RequestPerson } from '@/server/requests';

import YouBadge from '../_people/you-badge';

/** The names that stand in for someone without a name, or whose account is gone: their side's. */
export interface SideNames {
  /** The request's company. */
  company: string;
  /** The name the staff are shown with. */
  staff: string;
}

/**
 * The name to show for someone in a request: their own, or their side's
 * (the company's, or the staff's) when they have none or their account is
 * gone.
 *
 * @param person - The person.
 * @param names - The names of the two sides.
 * @returns The name.
 */
export function personName(person: RequestPerson, names: SideNames): string {
  return person.name ?? names[person.side];
}

/**
 * Someone's avatar in a request: their picture, or their initials, in the
 * brand colour for the staff.
 *
 * @param props - Component props.
 * @param props.person - The person.
 * @param props.names - The names of the two sides.
 * @param props.size - Its size: `sm` next to what someone wrote, `xs` in a list of names.
 * @returns The avatar.
 */
export function PersonAvatar({
  person,
  names,
  size = 'sm',
}: {
  person: RequestPerson;
  names: SideNames;
  size?: 'xs' | 'sm';
}) {
  return (
    <Avatar
      name={personName(person, names)}
      size={size}
      brand={person.side === 'staff'}
      src={person.picture}
    />
  );
}

/**
 * The avatars of several people in a row, overlapping a little, each with
 * the person's name on hover (where the names don't fit, as in a table).
 * The avatars are hidden from screen readers: whoever uses this gives the
 * names as text too. Where only the first few people are shown, a block of
 * the same size after them says how many more there are (`more`).
 *
 * @param props - Component props.
 * @param props.people - The people, in the order to show them.
 * @param props.names - The names of the two sides.
 * @param props.more - What the block after the avatars says, e.g. "+3"; no block when left out.
 * @returns The row of avatars.
 */
export function PeopleAvatars({
  people,
  names,
  more = null,
}: {
  people: readonly RequestPerson[];
  names: SideNames;
  more?: string | null;
}) {
  return (
    <span className="flex -space-x-1">
      {people.map((person, index) => {
        const name = personName(person, names);
        return (
          <Avatar
            // eslint-disable-next-line react/no-array-index-key -- names can repeat and readers at the company get no IDs; the row is read whole on each render
            key={index}
            name={name}
            size="sm"
            brand={person.side === 'staff'}
            title={name}
            src={person.picture}
            className="ring-2 ring-surface"
          />
        );
      })}
      {more !== null && (
        <span
          aria-hidden="true"
          className="relative inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg bg-muted px-1 text-xs font-semibold text-foreground ring-2 ring-surface"
        >
          {more}
        </span>
      )}
    </span>
  );
}

/**
 * Someone's name with their labels, in a line that wraps, followed by
 * whatever belongs after it (when they wrote something). The name links to
 * the user's page for readers who got their ID (`RequestPerson.userId`: the
 * staff). Someone shown by their side's name stays plain text: a link that
 * reads like the company would open a user.
 *
 * @param props - Component props.
 * @param props.person - The person.
 * @param props.names - The names of the two sides.
 * @param props.sideLabel - Whether a staff member gets the label with the staff's name; left
 *   out where everyone listed is staff anyway (the assignees).
 * @param props.children - What follows the name, e.g. a time.
 * @returns The line.
 */
export default function PersonLine({
  person,
  names,
  sideLabel = true,
  children = null,
}: {
  person: RequestPerson;
  names: SideNames;
  sideLabel?: boolean;
  children?: ReactNode;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {person.userId !== null && person.name !== null ? (
        <TextLink standalone href={`/admin/users/${person.userId}`} className="wrap-anywhere">
          {person.name}
        </TextLink>
      ) : (
        <span className="font-medium wrap-anywhere text-foreground">
          {personName(person, names)}
        </span>
      )}
      {/* Someone shown by the staff's name needs no label that repeats it. */}
      {sideLabel && person.side === 'staff' && person.name !== null && <Badge>{names.staff}</Badge>}
      {person.isViewer && <YouBadge />}
      {children}
    </p>
  );
}
