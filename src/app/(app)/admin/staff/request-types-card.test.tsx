/**
 * @file Tests for the Staff page's card of request types.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RequestTypeView } from '@/server/requests';

import RequestTypesCard from './request-types-card';

vi.mock('./actions', () => ({
  addRequestTypeAction: vi.fn(),
  updateRequestTypeAction: vi.fn(),
  moveRequestTypeAction: vi.fn(),
  archiveRequestTypeAction: vi.fn(),
  restoreRequestTypeAction: vi.fn(),
}));

/** Three types: the first and second active, the last archived. */
const TYPES: RequestTypeView[] = [
  {
    key: 'hotfix',
    name: 'Hotfix',
    description: 'Something is broken.',
    startingPriority: 'high',
    archived: false,
  },
  {
    key: 'bug',
    name: 'Bug',
    description: 'Something doesn’t work.',
    startingPriority: 'normal',
    archived: false,
  },
  {
    key: 'printers',
    name: 'Printers',
    description: 'A printer acts up.',
    startingPriority: 'low',
    archived: true,
  },
];

describe('RequestTypesCard', () => {
  it('lists the types in order, with what each is for and its starting priority', () => {
    render(<RequestTypesCard types={TYPES} />);

    const card = screen.getByRole('region', { name: 'Request types' });
    expect(within(card).getByRole('button', { name: 'Add type' })).toBeInTheDocument();
    const items = within(card)
      .getByRole('list', { name: 'Request types' })
      .querySelectorAll(':scope > li');
    expect([...items].map((item) => item.textContent)).toEqual([
      expect.stringContaining('HotfixHigh prioritySomething is broken.'),
      expect.stringContaining('BugNormal prioritySomething doesn’t work.'),
      expect.stringContaining('PrintersLow priorityArchivedA printer acts up.'),
    ]);
  });

  it('turns Up off on the first type and Down on the last, which stay focusable', () => {
    render(<RequestTypesCard types={TYPES} />);

    const up = screen.getByRole('button', { name: 'Move Hotfix up' });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Hotfix down' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move Printers down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('offers Archive for an active type and Restore for an archived one', () => {
    render(<RequestTypesCard types={TYPES} />);

    expect(screen.getByRole('button', { name: 'Archive Bug' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Printers' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore Printers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Printers' })).toBeInTheDocument();
  });
});
