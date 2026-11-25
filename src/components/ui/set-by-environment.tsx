/**
 * @file For a setting the server's environment chooses, which Settings then
 * only shows (where files are kept, the largest file, and any other setting
 * an operator can fix in the environment): the sentence that says so and
 * names the variable, as a note above what was chosen, and for a locked
 * field's description. Its text is `common.setByEnvironment`, so every page
 * has it; it works in Server and client components alike.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

/**
 * The sentence for a setting the environment chooses, e.g. for a locked
 * field's `description` (with the field `disabled`, and no button that
 * could only be refused).
 *
 * @returns A function that gives the sentence for a variable, e.g. `ATTACHMENTS_MAX_FILE_MB`.
 */
export function useSetByEnvironment(): (variable: string) => string {
  const t = useTranslations('common');
  return (variable) => t('setByEnvironment', { variable });
}

/**
 * The note for a setting the environment chooses, above what it chose
 * (e.g. a `DescriptionList` without any secret), in place of the form.
 *
 * @param props - Props.
 * @param props.variable - The environment variable that chooses it, e.g. `ATTACHMENTS_STORAGE`.
 * @param props.children - What it chose.
 */
export default function SetByEnvironment({
  variable,
  children = null,
}: {
  variable: string;
  children?: ReactNode;
}) {
  const sentence = useSetByEnvironment();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{sentence(variable)}</p>
      {children}
    </div>
  );
}
