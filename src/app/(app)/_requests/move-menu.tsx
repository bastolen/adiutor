/**
 * @file A card's Move menu on the board of requests: the button that names
 * the request and the lanes the reader may move it to. Its text comes from
 * `requests.board`, which the board's page passes through `ClientMessages`.
 */
import { ArrowRightLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import Button from '@/components/ui/button';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTransientState } from '@/components/ui/use-transient-state';
import type { RequestStatus } from '@/lib/requests';

/**
 * Props for {@link MoveMenu}.
 */
interface MoveMenuProps {
  /** The card's request ID: the button carries it (`data-request`), so focus can find it again. */
  id: string;
  /** The request's number as people see it ("AD-142"), which names the button. */
  reference: string;
  /** The lanes the reader may move the card to, in the board's order. */
  moves: readonly RequestStatus[];
  /** Each lane's name, as its heading says it. */
  names: Readonly<Record<RequestStatus, string>>;
  /** Whether the card is being moved: the button is busy and the menu doesn't open. */
  busy: boolean;
  /**
   * Called with the lane the reader picked. Whoever moves the card puts
   * focus where it belongs afterwards, so the menu doesn't give it back to
   * its button (which may be gone, or a dialog may want it).
   */
  onChoose: (to: RequestStatus) => void;
}

/**
 * A small button ("Move", named "Move AD-142" for screen readers) that opens
 * a menu with the lanes the card may go to (Radix brings the arrow keys,
 * typeahead and Escape, which closes it with focus back on the button).
 * While the card is being moved the button says "Moving…" with a spinner and
 * is busy, not disabled, so it keeps focus; the menu doesn't open then. It
 * sits above the card's stretched link (`z-10`), so pressing it never opens
 * the request. The menu's open state is transient, so it isn't still open
 * when the reader comes back to the page.
 *
 * @param props - Menu props.
 * @param props.id - The card's request ID.
 * @param props.reference - The request's number as people see it.
 * @param props.moves - The lanes it may go to.
 * @param props.names - Each lane's name.
 * @param props.busy - Whether it's being moved.
 * @param props.onChoose - Called with the lane picked.
 * @returns The menu's button (the menu itself opens in a portal).
 */
export default function MoveMenu({ id, reference, moves, names, busy, onChoose }: MoveMenuProps) {
  const t = useTranslations('requests.board');
  const [open, setOpen] = useTransientState(false);
  // Set when a lane was picked: the board places focus then, not the menu.
  const chosen = useRef(false);

  return (
    <MenuRoot open={open} onOpenChange={(next) => setOpen(next && !busy)}>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          data-request={id}
          className="relative z-10"
        >
          {!busy && <ArrowRightLeft aria-hidden="true" />}
          <span aria-hidden="true">{busy ? t('moving') : t('move')}</span>
          <span className="sr-only">{t('moveCard', { reference })}</span>
        </Button>
      </MenuTrigger>
      <MenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (chosen.current) {
            chosen.current = false;
            event.preventDefault();
          }
        }}
      >
        <MenuLabel>{t('moveTo')}</MenuLabel>
        {moves.map((to) => (
          <MenuItem
            key={to}
            onSelect={() => {
              chosen.current = true;
              onChoose(to);
            }}
          >
            {names[to]}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
