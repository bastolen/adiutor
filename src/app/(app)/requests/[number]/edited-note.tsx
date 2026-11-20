/**
 * @file What follows the time of a description or reply that was edited: a
 * separator and the "Edited" mark, with the text's earlier versions rendered
 * for the staff. Its text comes from `requests.edit`.
 */
import { useLocale, useTranslations } from 'next-intl';

import { formatDateTime } from '@/lib/format';
import type { RequestText as RequestTextValue } from '@/server/requests';

import { personName, type SideNames } from '../../_requests/request-person';
import RequestText, { type TextSource } from '../../_requests/request-text';
import EditedMark from './edited-mark';

/**
 * "· Edited" after a text's time, or nothing for a text that was never
 * edited. The staff, who get the text's versions from the service, get them
 * here too, newest first, each as it read and with who changed it and when.
 *
 * @param props - Component props.
 * @param props.text - The text, with when it was edited and (for the staff) its versions.
 * @param props.id - A name no other text on the page has, for the versions' own IDs.
 * @param props.source - Where the text is from, for the versions' notes on copied code.
 * @param props.names - The names of the two sides.
 * @returns The note, or nothing.
 */
export default function EditedNote({
  text,
  id,
  source,
  names,
}: {
  text: RequestTextValue;
  id: string;
  source: TextSource;
  names: SideNames;
}) {
  const t = useTranslations('requests.edit');
  const locale = useLocale();
  if (!text.editedAt) {
    return null;
  }
  const versions = text.versions && (
    <ol className="flex flex-col gap-5">
      {text.versions.map((version, index) => (
        // eslint-disable-next-line react/no-array-index-key -- Versions only ever come newest first, and none has an ID of its own on the page.
        <li key={index} className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t('versionLine', {
              name: personName(version.editedBy, names),
              time: formatDateTime(version.at, locale),
            })}
          </p>
          <RequestText
            text={{ text: version.text, format: version.format }}
            id={`${id}-version-${index}`}
            className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
            source={source}
            names={names}
          />
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <span aria-hidden="true">·</span>
      <EditedMark editedAt={text.editedAt} versions={versions} />
    </>
  );
}
