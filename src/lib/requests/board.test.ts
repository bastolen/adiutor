/**
 * @file Tests for the board's rules: the lanes and their order, the closed
 * lanes, the audience a lane is worded for, why a drop is refused, and
 * placing a moved card.
 */
import { describe, expect, it } from 'vitest';

import {
  BOARD_LANES,
  type BoardLaneState,
  isClosedLane,
  laneAudience,
  moveRefusal,
  placeMovedCard,
} from './board';

describe('the board’s lanes', () => {
  it('are the statuses, in the order a request moves through them', () => {
    expect(BOARD_LANES).toEqual([
      'open',
      'todo',
      'in_progress',
      'waiting',
      'proposed',
      'done',
      'cancelled',
    ]);
  });

  it('hold closed requests in Done and Cancelled only', () => {
    expect(BOARD_LANES.filter(isClosedLane)).toEqual(['done', 'cancelled']);
  });

  it('are worded for the reader’s strongest part in the companies on the board', () => {
    expect(laneAudience(['follower', 'contributor'])).toBe('contributor');
    expect(laneAudience(['follower', 'staff', 'contributor'])).toBe('staff');
    expect(laneAudience(['follower'])).toBe('follower');
    expect(laneAudience([])).toBe('follower');
  });
});

describe('a refused drop', () => {
  const staffCard = {
    status: 'in_progress' as const,
    moves: ['open', 'todo', 'waiting', 'done', 'cancelled'] as const,
    audience: 'staff' as const,
  };
  const clientCard = {
    status: 'proposed' as const,
    moves: ['cancelled'] as const,
    audience: 'contributor' as const,
  };

  it('isn’t one when the card may go there, or stays where it is', () => {
    expect(moveRefusal(staffCard, 'done')).toBeNull();
    expect(moveRefusal(staffCard, 'in_progress')).toBeNull();
  });

  it('says why the card can’t go there', () => {
    expect(moveRefusal({ ...staffCard, moves: [] }, 'done')).toBe('readOnly');
    expect(moveRefusal(staffCard, 'proposed')).toBe('proposedComesWithReply');
    expect(moveRefusal(clientCard, 'done')).toBe('approveOnRequest');
    expect(moveRefusal(clientCard, 'in_progress')).toBe('staffSetsThat');
    expect(moveRefusal({ ...staffCard, status: 'open', moves: ['todo'] }, 'waiting')).toBe(
      'notFromHere',
    );
  });
});

describe('placing a moved card', () => {
  /** Three lanes with two cards in In progress. */
  const lanes: BoardLaneState<{ id: string; status: 'open' | 'in_progress' | 'done' }>[] = [
    { status: 'open', total: 4, items: [] },
    {
      status: 'in_progress',
      total: 2,
      items: [
        { id: 'a', status: 'in_progress' },
        { id: 'b', status: 'in_progress' },
      ],
    },
    { status: 'done', total: 30, items: [{ id: 'c', status: 'done' }] },
  ];

  it('takes it out of its lane and puts it on top of the new one, with both counts', () => {
    expect(placeMovedCard(lanes, 'b', 'done')).toEqual([
      { status: 'open', total: 4, items: [] },
      { status: 'in_progress', total: 1, items: [{ id: 'a', status: 'in_progress' }] },
      {
        status: 'done',
        total: 31,
        items: [
          { id: 'b', status: 'done' },
          { id: 'c', status: 'done' },
        ],
      },
    ]);
  });

  it('leaves the lanes as they are for a card that isn’t there, or a move to its own lane', () => {
    expect(placeMovedCard(lanes, 'missing', 'done')).toEqual(lanes);
    expect(placeMovedCard(lanes, 'a', 'in_progress')).toEqual(lanes);
  });
});
