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
  Maximize2,
  Minimize2,
  SquareCode,
  Strikethrough,
  TextQuote,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';

import { isStaffPage, linkTarget } from '@/lib/requests';

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
import { Toolbar, ToolbarButton, ToolbarSeparator, ToolbarTextButton } from '../toolbar';
import { useTransientState } from '../use-transient-state';
import type { CodeLanguageChoice } from './languages';

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
  /** The language the block of code at the cursor names, as it was written, or `null`. */
  codeLanguage: string | null;
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
    }
  | {
      /** Say which language the block of code at the cursor is in. */
      type: 'codeLanguage';
      /** The language's key, or `null` for no language. */
      language: string | null;
    };

/**
 * What a toolbar without an editor does with a command: nothing. Its buttons
 * are disabled then (its `state` is `null`), as in the field's place before
 * the editor is there and in the editor's place while it's open large.
 */
export function ignoreCommand(): void {}

/** The lowest heading the menu offers; a deeper one (typed with more `#`) shows as this one. */
const LOWEST_OFFERED_HEADING = 3;

/** The choices of the heading menu: text that isn't a heading, and three levels. */
const HEADING_CHOICES = [0, 1, 2, LOWEST_OFFERED_HEADING];

/**
 * The dialog that asks for a link's address. Only a whole `http` or `https`
 * address is taken, as that's all a text may link to, and in a text the
 * company reads never one of the staff's pages (`isStaffPage`).
 *
 * @param props - Component props.
 * @param props.current - The address of the link at the cursor, or `null`.
 * @param props.appUrl - Adiutor's own address (see `MarkdownElementsOptions.appUrl`).
 * @param props.onSave - Called with the address to link to.
 * @param props.onRemove - Called to remove the link.
 */
function LinkForm({
  current,
  appUrl,
  onSave,
  onRemove,
}: {
  current: string | null;
  appUrl: string | null;
  onSave: (address: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('common.markdown.linkDialog');
  const [address, setAddress] = useState(current ?? '');
  // Why the address was refused: not a whole web address, or a page for the staff.
  const [refused, setRefused] = useState<'invalid' | 'staffPage' | null>(null);

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
      setRefused('invalid');
      return;
    }
    if (appUrl !== null && isStaffPage(target, appUrl)) {
      setRefused('staffPage');
      return;
    }
    onSave(target);
  };

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      {refused && <Alert tone="error">{t(refused)}</Alert>}
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
 * What a menu and the link dialog ask for is passed on once they have
 * closed, so the text gets the focus afterwards, not their button: each
 * passes it on at the moment it would give its button the focus back
 * (a menu's `onCloseAutoFocus`, the dialog's `finalFocus`) and doesn't. One
 * moment, not a timer of its own: on a slow device a timer could run before
 * the dialog hands the focus back, which then took it from the text.
 * Closing a menu without a choice (Escape) gives its button the focus back.
 *
 *
 * While the cursor is in a block of code, a menu at the end picks its
 * language, once the languages are known.
 *
 * The last button, at the toolbar's far end, opens the editor large and
 * brings it back (`onLarge`), and says which it is now. It stays usable
 * while the editor is large, also when the field is switched off meanwhile,
 * so the large view can always be left with it.
 *
 * @param props - Component props.
 * @param props.state - What's on at the cursor, or `null` while there's no editor to act on.
 * @param props.onCommand - Called with what a pressed button asks for.
 * @param props.languages - The languages a block of code can be in, or `null` until they've loaded.
 * @param props.languageName - Gives a language's name as people know it, once the languages have loaded.
 * @param props.large - Whether the editor is open large.
 * @param props.onLarge - Called to open the editor large, or to bring it back; without it the button is switched off.
 * @param props.appUrl - Adiutor's own address, for a text the company reads: the link dialog
 *   refuses a page for the staff there. `null` (the default) for a text only the staff read.
 */
export default function FormattingToolbar({
  state,
  onCommand,
  languages = null,
  languageName = undefined,
  large = false,
  onLarge = undefined,
  appUrl = null,
}: {
  state: FormattingState | null;
  onCommand: (command: FormattingCommand) => void;
  languages?: CodeLanguageChoice[] | null;
  languageName?: (language: string) => string | null;
  large?: boolean;
  onLarge?: () => void;
  appUrl?: string | null;
}) {
  const t = useTranslations('common.markdown.toolbar');
  const tLink = useTranslations('common.markdown.linkDialog');
  // The dialog is closed again when the user comes back to a page that was kept.
  const [linking, setLinking] = useTransientState(false);
  const off = state === null;
  // The language of the block of code at the cursor: its name, and its key among the choices
  // (it may have been typed as an alias, "ts").
  const written = state?.codeLanguage ?? null;
  const codeName = written === null ? null : (languageName?.(written) ?? written);
  const codeChoice = languages?.find((choice) => choice.name === codeName)?.id ?? written ?? '';
  // What the link dialog asked for, until it has closed.
  const linkChoice = useRef<FormattingCommand | null>(null);
  // What the heading or language menu asked for, until it closes.
  const chosen = useRef<FormattingCommand | null>(null);

  /**
   * Passes on what a menu asked for as it closes, instead of letting it give
   * its button the focus back: the command gives the text the focus. A menu
   * closed without a choice gives its button the focus back as usual.
   *
   * @param event - The menu's focus-return event.
   */
  const passChoice = (event: Event) => {
    const command = chosen.current;
    if (command) {
      chosen.current = null;
      event.preventDefault();
      onCommand(command);
    }
  };

  /**
   * Passes on what the link dialog asked for, at the moment it would give
   * the Link button the focus back: the command gives the text the focus. A
   * dialog closed without a choice (Escape, the close button) gives the
   * button the focus back as usual.
   *
   * @returns `false` when the dialog asked for nothing.
   */
  const passLinkChoice = () => {
    const command = linkChoice.current;
    if (!command) {
      return false;
    }
    linkChoice.current = null;
    onCommand(command);
    return true;
  };

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
          <MenuContent align="start" onCloseAutoFocus={passChoice}>
            <MenuRadioGroup
              value={String(Math.min(state?.heading ?? 0, LOWEST_OFFERED_HEADING))}
              onValueChange={(level) => {
                chosen.current = { type: 'heading', level: Number(level) };
              }}
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
        {state?.codeBlock && languages && (
          <MenuRoot>
            <MenuTrigger asChild>
              <ToolbarTextButton
                aria-label={t('codeLanguage', { language: codeName ?? t('noLanguage') })}
              >
                {codeName ?? t('noLanguage')}
              </ToolbarTextButton>
            </MenuTrigger>
            <MenuContent
              align="end"
              className="max-h-72 overflow-y-auto"
              onCloseAutoFocus={passChoice}
            >
              <MenuRadioGroup
                value={codeChoice}
                onValueChange={(language) => {
                  chosen.current = { type: 'codeLanguage', language: language || null };
                }}
              >
                <MenuRadioItem value="">{t('noLanguage')}</MenuRadioItem>
                {languages.map((choice) => (
                  <MenuRadioItem key={choice.id} value={choice.id}>
                    {choice.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </MenuRoot>
        )}
        <ToolbarButton
          label={t('large')}
          icon={large ? Minimize2 : Maximize2}
          pressed={large}
          disabled={onLarge === undefined || (off && !large)}
          onClick={onLarge}
          className="ml-auto"
        />
      </Toolbar>
      <Modal
        open={linking}
        onOpenChange={setLinking}
        title={tLink('title')}
        description={tLink('description')}
        finalFocus={passLinkChoice}
      >
        <LinkForm
          current={state?.link ?? null}
          appUrl={appUrl}
          onSave={(address) => {
            linkChoice.current = { type: 'link', address };
            setLinking(false);
          }}
          onRemove={() => {
            linkChoice.current = { type: 'link', address: null };
            setLinking(false);
          }}
        />
      </Modal>
    </>
  );
}
