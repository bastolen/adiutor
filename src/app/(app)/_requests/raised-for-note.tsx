/**
 * @file The note on a request a staff member raised for someone at the
 * company (decision 0047): "Ann raised this for Pat", "…for you" for Pat and
 * "You raised this for Pat" for Ann. Every reader of the request gets it.
 * Its text comes from `requests.raisedFor`.
 */
import { Headset } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { RequestPerson } from '@/server/requests';

import { personName, type SideNames } from './request-person';

/**
 * The note, with a decorative icon. After a time it starts with a
 * separator; on a line of its own, it doesn't.
 *
 * @param props - Component props.
 * @param props.staff - The staff member who raised it (`RequestDetail.raisedOnBehalf`).
 * @param props.person - Who they raised it for (`RequestDetail.raisedBy`).
 * @param props.names - The names of the two sides.
 * @param props.separated - Whether it follows something on the same line (the default).
 * @returns The note.
 */
export default function RaisedForNote({
  staff,
  person,
  names,
  separated = true,
}: {
  staff: RequestPerson;
  person: RequestPerson;
  names: SideNames;
  separated?: boolean;
}) {
  const t = useTranslations('requests.raisedFor');
  let text: string;
  if (staff.isViewer) {
    text = t('byYou', { name: personName(person, names) });
  } else if (person.isViewer) {
    text = t('forYou', { staff: personName(staff, names) });
  } else {
    text = t('forName', { staff: personName(staff, names), name: personName(person, names) });
  }
  return (
    <>
      {separated && <span aria-hidden="true">·</span>}
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Headset aria-hidden="true" className="size-3.5 shrink-0" />
        {text}
      </span>
    </>
  );
}
