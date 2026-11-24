/**
 * @file A request's description or reply that its reader may edit: the text
 * with an Edit button beside it, which swaps the text for the editor. Its
 * text comes from `requests.edit`, which the page passes through
 * `ClientMessages`.
 */
'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';

import Button from '@/components/ui/button';
import MarkdownField from '@/components/ui/markdown/markdown-field';
import ResultAlert from '@/components/ui/result-alert';
import { useToast } from '@/components/ui/toast';
import { useTransientActionState, useTransientState } from '@/components/ui/use-transient-state';
import type { ActionResult } from '@/lib/action-result';
import { REQUEST_TEXT_MAX_LENGTH } from '@/lib/input-rules';

import { mentionChoicesAction } from '../../_requests/mention-actions';
import { editTextAction } from './actions';

/** Props for {@link EditableText}. */
interface EditableTextProps {
  /** The request's number. */
  request: number;
  /** The reply's or note's ID; `null` for the request's description. */
  entry: string | null;
  /** Whether the entry is an internal note: the button and field say "note". */
  note?: boolean;
  /** What the editor starts from, and how many times the text was edited (sent back). */
  edit: { markdown: string; edits: number };
  /** The text as it reads, rendered on the server. */
  children: ReactNode;
}

/**
 * The text with an Edit button (a pencil, named "Edit description", "Edit
 * reply" or "Edit note") beside it. The button swaps the text for a Markdown editor holding
 * it, with Save and Cancel. Saving refreshes the page, so the text shows as
 * saved; a success is a toast, a refusal shows above the editor and as a
 * toast, and the editor stays open with what was typed. Cancel, and a save,
 * put the text back and focus on the Edit button again. A staff member
 * signed in as the user may edit it too (decision 0028).
 *
 * Whether the reader may edit the text is decided on the server: the page
 * only renders this for a text they may edit.
 *
 * @param props - Component props.
 * @param props.request - The request's number.
 * @param props.entry - The reply's or note's ID, or `null` for the description.
 * @param props.note - Whether it's an internal note.
 * @param props.edit - What the editor starts from.
 * @param props.children - The text as it reads.
 * @returns The text and its button, or the editor.
 */
export default function EditableText({
  request,
  entry,
  note = false,
  edit,
  children,
}: EditableTextProps) {
  const t = useTranslations('requests.edit');
  const tCommon = useTranslations('common');
  const showToast = useToast();
  const [editing, setEditing] = useTransientState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Set when the editor closes, so the Edit button takes focus once it's back.
  const backToButton = useRef(false);
  const loadMentions = useCallback(
    () => mentionChoicesAction({ request: String(request) }),
    [request],
  );
  // Toasts a success as soon as the action returns, and closes the editor.
  const run = useCallback(
    async (previous: ActionResult | null, formData: FormData) => {
      const next = await editTextAction(previous, formData);
      if (next.ok) {
        if (showToast && next.message) {
          showToast(next.message, { tone: 'success' });
        }
        backToButton.current = true;
        setEditing(false);
      }
      return next;
    },
    [setEditing, showToast],
  );
  const [result, formAction, pending, onSubmit] = useTransientActionState(run, null);
  // What the button and the field are called: for the description, a reply or a note.
  let name = t('editDescription');
  let fieldLabel = t('descriptionLabel');
  if (note) {
    name = t('editNote');
    fieldLabel = t('noteLabel');
  } else if (entry) {
    name = t('editReply');
    fieldLabel = t('replyLabel');
  }

  useEffect(() => {
    if (!editing && backToButton.current) {
      backToButton.current = false;
      button.current?.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3">
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="entry" value={entry ?? ''} />
        <input type="hidden" name="edits" value={edit.edits} />
        <ResultAlert result={result} errorsOnly />
        <MarkdownField
          label={fieldLabel}
          name="text"
          rows={entry ? 6 : 10}
          maxLength={REQUEST_TEXT_MAX_LENGTH}
          required
          defaultValue={edit.markdown}
          autoFocus
          mentions={loadMentions}
          staffOnly={note}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>
            {t('save')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              backToButton.current = true;
              setEditing(false);
            }}
          >
            {tCommon('actions.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="sm"
        aria-label={name}
        title={name}
        onClick={() => setEditing(true)}
      >
        <Pencil aria-hidden="true" />
      </Button>
    </div>
  );
}
