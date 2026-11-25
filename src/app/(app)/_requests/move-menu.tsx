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
  /** The request's number as people see it ("AD-142"), which names the button and its menu. */
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
 * A small button that shows "Move" and names itself "Move AD-142"
 * (`aria-label`, which holds the word it shows, WCAG 2.5.3), and opens a
 * menu with the lanes the card may go to (Radix brings the arrow keys,
 * typeahead and Escape, which closes it with focus back on the button). The
 * menu is named by its button, so it's "Move AD-142" too: the button's
 * name is its `aria-label` alone, never its text and a copy for screen
 * readers, which the open menu would read both of ("Move Move AD-142").
 * While the card is being moved a spinner takes the icon's place and the
 * button still says "Move", as the Sort menu's does, so its name keeps
 * holding what it shows; it's busy (`aria-busy`), not disabled, so it keeps
 * focus and its name, and the menu doesn't open then. It sits above the card's stretched link (`z-10`),
 * so pressing it never opens the request. The menu's open state is
 * transient, so it isn't still open when the reader comes back to the page.
 *
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
          aria-label={t('moveCard', { reference })}
          className="relative z-10"
        >
          {/* While busy, the spinner takes the icon's place and the word stays, so the name
              still holds what the button shows. */}
          {!busy && <ArrowRightLeft aria-hidden="true" />}
          {t('move')}
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
