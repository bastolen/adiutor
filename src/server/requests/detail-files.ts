/**
 * @file Every file on a request that its reader may open, in one list: for
 * the Files card on the request's page and for the viewer that steps through
 * them (decisions 0044 and 0058). The texts' own tiles get only the texts the
 * page shows (the latest entries of the groups the reader shows), so this list
 * is what finds a file on an older reply or in a hidden group. Part of
 * reading one request (`getRequest` in `detail.ts`).
 */
import {
  type ActivityOrder,
  STAFF_ONLY_ENTRY_KINDS,
  WRITTEN_ENTRY_KINDS,
  type WrittenEntryKind,
} from '@/lib/requests';

import { type RequestPerson, requestPerson } from './access';
import type { PageReader } from './detail-reader';
import type { loadTextRows } from './detail-texts';

/**
 * A file on a request, as its reader gets it in the list of every file: to
 * open from `/attachments/<id>`, with its preview at
 * `/attachments/<id>/preview` when it has one, and the text it was sent with.
 */
export interface RequestFileView {
  /** Its ID, which its addresses hold. */
  id: string;
  /** Its name. */
  name: string;
  /** Its size in bytes. */
  size: number;
  /** Whether it has a preview. */
  preview: boolean;
  /**
   * The reply or internal note it was sent with, by the text's author and
   * when it was written: where it was sent, not who uploaded it (whoever
   * edits a text may add files to it). `null` for the description's files.
   */
  entry: { id: string; kind: WrittenEntryKind; author: RequestPerson; at: Date } | null;
}

/** The attachments' rows as `loadTextRows` loads them. */
type AttachmentRow = Awaited<ReturnType<typeof loadTextRows>>['attached'][number];

/**
 * Whether an entry's kind holds a text.
 *
 * @param kind - The entry's kind.
 * @returns Whether it's a reply or a note.
 */
function isWritten(kind: string): kind is WrittenEntryKind {
  return (WRITTEN_ENTRY_KINDS as readonly string[]).includes(kind);
}

/**
 * Every file on a request its reader may open, in the page's order: the
 * description's first, then each reply's and note's in the order the reader
 * reads the conversation (`order`), each text's files oldest first. Removed
 * files are left out (their place in their text says who removed them), and
 * so is a note's file for a reader without `requests:view-internal`: the
 * query leaves those rows out already (`ofShownText`), and this checks it
 * again, since what only the staff see is filtered in the service. Authors
 * are named as the page names them, without pictures.
 *
 * @param reader - Who reads them.
 * @param rows - The request's attachments' rows (`loadTextRows`), oldest first.
 * @param order - The order the reader reads the conversation in.
 * @returns The files.
 */
export default function requestFiles(
  reader: PageReader,
  rows: readonly AttachmentRow[],
  order: ActivityOrder,
): RequestFileView[] {
  const files = rows.flatMap((row): RequestFileView[] => {
    if (row.removedAt !== null) {
      return [];
    }
    const file = {
      id: row.id,
      name: row.name,
      size: row.size,
      preview: row.preview === 'drawn',
    };
    if (row.entryId === null) {
      return [{ ...file, entry: null }];
    }
    const { entry } = row;
    if (
      entry === null ||
      !isWritten(entry.kind) ||
      (!reader.internal && (STAFF_ONLY_ENTRY_KINDS as readonly string[]).includes(entry.kind))
    ) {
      return [];
    }
    return [
      {
        ...file,
        entry: {
          id: row.entryId,
          kind: entry.kind,
          author: requestPerson(
            row.entryAuthor ?? { id: null, name: null },
            entry.authorSide,
            reader.actor,
          ),
          at: entry.at,
        },
      },
    ];
  });
  // Entry IDs are UUIDv7, so they sort as the entries were written, as the conversation does. The
  // sort is stable: the files of one text keep the order they were loaded in, oldest first.
  const newestFirst = order === 'newest';
  return files.sort((a, b) => {
    if (a.entry === null || b.entry === null) {
      return (a.entry === null ? 0 : 1) - (b.entry === null ? 0 : 1);
    }
    if (a.entry.id === b.entry.id) {
      return 0;
    }
    return a.entry.id < b.entry.id === newestFirst ? 1 : -1;
  });
}
