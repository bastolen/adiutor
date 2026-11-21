/**
 * @file A card on the board of requests: what the server rendered of its
 * request (`BoardCardView.body` and `meta`), with its Move menu. Its text
 * comes from `requests.board`.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { RequestStatus } from '@/lib/requests';

import MoveMenu from './move-menu';

/** A card as the board's browser part gets it: what it needs to move it, and what to show. */
export interface BoardCardView {
  /** The request's ID. */
  id: string;
  /** Its number, which a move names. */
  number: number;
  /** Its number as people see it ("AD-142"). */
  reference: string;
  /** Its status: the lane it's in. */
  status: RequestStatus;
  /** The lanes the reader may move it to; none for a card they only read. */
  moves: RequestStatus[];
  /**
   * What the card says, rendered on the server: its number, type and title
   * (a link stretched over the card), and its priority, company and labels
   * where they apply.
   */
  body: ReactNode;
  /** Its footer, rendered on the server: who it's assigned to and its last activity. */
  meta: ReactNode;
}

/**
 * Props for {@link BoardCard}.
 */
interface BoardCardProps {
  /** The card. */
  card: BoardCardView;
  /** Each lane's name, for the Move menu. */
  names: Readonly<Record<RequestStatus, string>>;
  /** Whether it's being moved. */
  busy: boolean;
  /**
   * Called with the lane the reader picked in the Move menu.
   *
   * @param card - The card.
   * @param to - The lane.
   */
  onChoose: (card: BoardCardView, to: RequestStatus) => void;
}

/**
 * One card: its content, and below it its footer next to the Move menu
 * (none for a card the reader can't move). The whole card is one click
 * target for the request, through the title's stretched link; the Move
 * button and the avatars sit above it. While it's being moved, a status
 * message says so to screen readers ("Moving AD-142…").
 *
 * @param props - Card props.
 * @param props.card - The card.
 * @param props.names - Each lane's name.
 * @param props.busy - Whether it's being moved.
 * @param props.onChoose - Called with the lane picked.
 * @returns The card, as a list item.
 */
export default function BoardCard({ card, names, busy, onChoose }: BoardCardProps) {
  const t = useTranslations('requests.board');
  return (
    <li className="group relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-xs transition-colors hover:border-border-strong dark:bg-raised">
      {card.body}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {card.meta}
        {card.moves.length > 0 && (
          <MoveMenu
            id={card.id}
            reference={card.reference}
            moves={card.moves}
            names={names}
            busy={busy}
            onChoose={(to) => onChoose(card, to)}
          />
        )}
      </div>
      {busy && (
        <span role="status" className="sr-only">
          {t('movingCard', { reference: card.reference })}
        </span>
      )}
    </li>
  );
}
