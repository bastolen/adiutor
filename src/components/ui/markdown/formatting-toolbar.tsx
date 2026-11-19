/**
 * @file The formatting toolbar of the Markdown field: buttons for what
 * Markdown can do, for people who don't type it. It knows nothing of the
 * editor: it's told what's on at the cursor and says which button was
 * pressed, so the field can show it (switched off) before the editor has
 * loaded, and nothing moves when the editor takes over.
 */
'use client';

import {
  Bold,
  Code,
  Heading,
  Italic,
  Link2,
  List,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListTodo,
  SquareCode,
  Strikethrough,
  TextQuote,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useEffectEvent, useState } from 'react';

import { linkTarget } from '@/lib/requests';

import Alert from '../alert';
import Button from '../button';
import {
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from '../dropdown-menu';
import Modal from '../modal';
import TextField from '../text-field';
import { Toolbar, ToolbarButton, ToolbarSeparator } from '../toolbar';
import { useTransientState } from '../use-transient-state';

/** What's on where the cursor is, for the buttons that switch something. */
export interface FormattingState {
  /** Whether the text is bold. */
  bold: boolean;
  /** Whether it's italic. */
  italic: boolean;
  /** Whether it's struck through. */
  strike: boolean;
  /** Whether it's code inside a sentence. */
  code: boolean;
  /** The address of the link the cursor is in, or `null` outside a link. */
  link: string | null;
  /** The level of the heading the cursor is in (1 for the highest), or 0 in other text. */
  heading: number;
  /** Whether the cursor is in a list with bullets. */
  bulletList: boolean;
  /** Whether it's in a numbered list. */
  orderedList: boolean;
  /** Whether it's in a list of things to do. */
  taskList: boolean;
  /** Whether it's in a quotation. */
  quote: boolean;
  /** Whether it's in a block of code. */
  codeBlock: boolean;
  /** Whether the list item at the cursor can be nested under the one above it. */
  canNest: boolean;
  /** Whether it can be lifted out of the list it's nested in. */
  canLift: boolean;
}

/** The formatting a button switches on or off. */
type Toggle =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'codeBlock';

/** What a press of a button asks of the editor. */
export type FormattingCommand =
  | {
      /** Switch a kind of formatting, or nest or lift a list item. */
      type: Toggle | 'nest' | 'lift';
    }
  | {
      /** Make the block at the cursor a heading, or other text. */
      type: 'heading';
      /** The heading's level, or 0 for text that isn't a heading. */
      level: number;
    }
  | {
      /** Link the selected text, or remove its link. */
      type: 'link';
      /** The address to link to, or `null` to remove the link. */
      address: string | null;
    };

/** The lowest heading the menu offers; a deeper one (typed with more `#`) shows as this one. */
const LOWEST_OFFERED_HEADING = 3;

/** The choices of the heading menu: text that isn't a heading, and three levels. */
const HEADING_CHOICES = [0, 1, 2, LOWEST_OFFERED_HEADING];

/**
 * The dialog that asks for a link's address. Only a whole `http` or `https`
 * address is taken, as that's all a text may link to.
 *
 * @param props - Component props.
 * @param props.current - The address of the link at the cursor, or `null`.
 * @param props.onSave - Called with the address to link to.
 * @param props.onRemove - Called to remove the link.
 * @returns The dialog's content.
 */
function LinkForm({
  current,
  onSave,
  onRemove,
}: {
  current: string | null;
  onSave: (address: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('common.markdown.linkDialog');
  const [address, setAddress] = useState(current ?? '');
  const [refused, setRefused] = useState(false);

  /**
   * Takes the address, if it's one a text may link to.
   *
   * @param event - The submit event.
   */
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The dialog is rendered elsewhere on the page, but its events still reach the form the
    // field is in: this submit isn't that form's.
    event.stopPropagation();
    const target = linkTarget(address.trim());
    if (target === null) {
      setRefused(true);
      return;
    }
    onSave(target);
  };

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      {refused && <Alert tone="error">{t('invalid')}</Alert>}
      <TextField
        label={t('address')}
        type="url"
        inputMode="url"
        autoComplete="off"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {current !== null && (
          <Button variant="secondary" onClick={onRemove}>
            {t('remove')}
          </Button>
        )}
        <Button type="submit">{t('save')}</Button>
      </div>
    </form>
  );
}

/**
 * The toolbar. Each button names what it does, and one that switches
 * something says whether it's on. Without a state (before the editor is
 * there, or while the field is switched off) every button is disabled.
 * What the heading menu and the link dialog ask for is passed on once they
 * have closed, so the text gets the focus afterwards, not their button.
 *
 * @param props - Component props.
 * @param props.state - What's on at the cursor, or `null` while there's no editor to act on.
 * @param props.onCommand - Called with what a pressed button asks for.
 * @returns The toolbar.
 */
export default function FormattingToolbar({
  state,
  onCommand,
}: {
  state: FormattingState | null;
  onCommand: (command: FormattingCommand) => void;
}) {
  const t = useTranslations('common.markdown.toolbar');
  const tLink = useTranslations('common.markdown.linkDialog');
  // The dialog is closed again when the user comes back to a page that was kept.
  const [linking, setLinking] = useTransientState(false);
  const off = state === null;
  // What the heading menu or the link dialog asked for, until that layer has closed.
  const [waiting, setWaiting] = useState<FormattingCommand | null>(null);
  const pass = useEffectEvent(onCommand);

  useEffect(() => {
    if (waiting === null) {
      return undefined;
    }
    // A layer that closes gives the focus back to its button a moment later. The command goes
    // out after that, so the editor then takes the focus for the text, every time.
    const timer = setTimeout(() => {
      setWaiting(null);
      pass(waiting);
    }, 0);
    return () => clearTimeout(timer);
  }, [waiting]);

  /**
   * The props of a button that switches a kind of formatting.
   *
   * @param type - The formatting.
   * @returns Whether it's on, whether it can be pressed, and what a press does.
   */
  const toggle = (type: Toggle) => ({
    pressed: state?.[type] ?? false,
    disabled: off,
    /** Asks the editor to switch it. */
    onClick: () => {
      onCommand({ type });
    },
  });

  return (
    <>
      <Toolbar label={t('label')} className="border-b border-border px-1.5 py-1">
        <ToolbarButton label={t('bold')} icon={Bold} {...toggle('bold')} />
        <ToolbarButton label={t('italic')} icon={Italic} {...toggle('italic')} />
        <ToolbarButton label={t('strike')} icon={Strikethrough} {...toggle('strike')} />
        <ToolbarButton label={t('code')} icon={Code} {...toggle('code')} />
        <ToolbarButton
          label={t('link')}
          icon={Link2}
          pressed={(state?.link ?? null) !== null}
          disabled={off}
          onClick={() => setLinking(true)}
        />
        <ToolbarSeparator />
        <MenuRoot>
          <MenuTrigger asChild>
            <ToolbarButton label={t('heading')} icon={Heading} disabled={off} />
          </MenuTrigger>
          <MenuContent align="start">
            <MenuRadioGroup
              value={String(Math.min(state?.heading ?? 0, LOWEST_OFFERED_HEADING))}
              onValueChange={(level) => setWaiting({ type: 'heading', level: Number(level) })}
            >
              {HEADING_CHOICES.map((level) => (
                <MenuRadioItem key={level} value={String(level)}>
                  {t('headingOption', { level })}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </MenuRoot>
        <ToolbarButton label={t('bulletList')} icon={List} {...toggle('bulletList')} />
        <ToolbarButton label={t('orderedList')} icon={ListOrdered} {...toggle('orderedList')} />
        <ToolbarButton label={t('taskList')} icon={ListTodo} {...toggle('taskList')} />
        <ToolbarButton
          label={t('nest')}
          icon={ListIndentIncrease}
          disabled={!state?.canNest}
          onClick={() => onCommand({ type: 'nest' })}
        />
        <ToolbarButton
          label={t('lift')}
          icon={ListIndentDecrease}
          disabled={!state?.canLift}
          onClick={() => onCommand({ type: 'lift' })}
        />
        <ToolbarSeparator />
        <ToolbarButton label={t('quote')} icon={TextQuote} {...toggle('quote')} />
        <ToolbarButton label={t('codeBlock')} icon={SquareCode} {...toggle('codeBlock')} />
      </Toolbar>
      <Modal
        open={linking}
        onOpenChange={setLinking}
        title={tLink('title')}
        description={tLink('description')}
      >
        <LinkForm
          current={state?.link ?? null}
          onSave={(address) => {
            setLinking(false);
            setWaiting({ type: 'link', address });
          }}
          onRemove={() => {
            setLinking(false);
            setWaiting({ type: 'link', address: null });
          }}
        />
      </Modal>
    </>
  );
}
