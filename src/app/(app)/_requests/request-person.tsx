/**
 * @file Shows who raised, wrote or changed something in a request: their
 * name, a label with the staff's name on the staff's side, and "You" for the
 * reader. Never an email address: a company's Clients and Watchers can't see
 * who else is in it, beyond the names in its requests.
 */
import type { ReactNode } from 'react';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
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
 * Someone's avatar in a request: their initials, in the brand colour for
 * the staff.
 *
 * @param props - Component props.
 * @param props.person - The person.
 * @param props.names - The names of the two sides.
 * @returns The avatar.
 */
export function PersonAvatar({ person, names }: { person: RequestPerson; names: SideNames }) {
  return <Avatar name={personName(person, names)} size="sm" brand={person.side === 'staff'} />;
}

/**
 * Someone's name with their labels, in a line that wraps, followed by
 * whatever belongs after it (when they wrote something).
 *
 * @param props - Component props.
 * @param props.person - The person.
 * @param props.names - The names of the two sides.
 * @param props.children - What follows the name, e.g. a time.
 * @returns The line.
 */
export default function PersonLine({
  person,
  names,
  children = null,
}: {
  person: RequestPerson;
  names: SideNames;
  children?: ReactNode;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-medium wrap-anywhere text-foreground">{personName(person, names)}</span>
      {/* Someone shown by the staff's name needs no label that repeats it. */}
      {person.side === 'staff' && person.name !== null && <Badge>{names.staff}</Badge>}
      {person.isViewer && <YouBadge />}
      {children}
    </p>
  );
}
