/**
 * @file The mark on request work a staff member did while signed in as the
 * person it shows as theirs (decision 0028): "Ann did this while signed in as
 * you". Only the readers who may know get the mark from the service (that
 * person, and the staff who see the audit log), so this shows whatever it's
 * given. Its text comes from `requests.signedInAs`.
 */
import { UserCog } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { RequestPerson, SignedInAsMark as Mark } from '@/server/requests';

import { personName, type SideNames } from './request-person';

/** What the mark is about: a piece of work (raising, writing, a change), or an edit of a text. */
export type SignedInAsKind = 'work' | 'edit';

/**
 * The mark's sentence: the reader's own work says "you", anyone else's names
 * them, and a staff member whose account is gone is "a staff member".
 *
 * @param t - The `requests.signedInAs` messages.
 * @param kind - What the mark is about.
 * @param staff - The staff member's name, or `null`.
 * @param author - The person the work shows as theirs.
 * @param names - The names of the two sides.
 */
function markText(
  t: ReturnType<typeof useTranslations<'requests.signedInAs'>>,
  kind: SignedInAsKind,
  staff: string | null,
  author: RequestPerson,
  names: SideNames,
): string {
  const name = personName(author, names);
  if (kind === 'edit') {
    if (author.isViewer) {
      return staff ? t('editForYou', { staff }) : t('editForYouUnnamed');
    }
    return staff ? t('editFor', { staff, name }) : t('editForUnnamed', { name });
  }
  if (author.isViewer) {
    return staff ? t('workForYou', { staff }) : t('workForYouUnnamed');
  }
  return staff ? t('workFor', { staff, name }) : t('workForUnnamed', { name });
}

/**
 * The mark, with a decorative icon, or nothing for work done by the person
 * themselves (or for a reader who isn't told). After a time it starts with a
 * separator; on a line of its own (an earlier version's), it doesn't.
 *
 * @param props - Component props.
 * @param props.mark - What the service gave about the staff member, if anything.
 * @param props.author - The person the work shows as theirs.
 * @param props.names - The names of the two sides.
 * @param props.kind - What it's about: work (the default) or an edit.
 * @param props.separated - Whether it follows something on the same line (the default).
 * @returns The mark, or nothing.
 */
export default function SignedInAsMark({
  mark,
  author,
  names,
  kind = 'work',
  separated = true,
}: {
  mark: Mark | undefined;
  author: RequestPerson;
  names: SideNames;
  kind?: SignedInAsKind;
  separated?: boolean;
}) {
  const t = useTranslations('requests.signedInAs');
  if (!mark) {
    return null;
  }
  return (
    <>
      {separated && <span aria-hidden="true">·</span>}
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <UserCog aria-hidden="true" className="size-3.5 shrink-0" />
        {markText(t, kind, mark.staffName, author, names)}
      </span>
    </>
  );
}
