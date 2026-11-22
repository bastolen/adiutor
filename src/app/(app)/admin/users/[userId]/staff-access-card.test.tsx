/**
 * @file Tests for the "Staff access" card on the Overview tab of a user's page: someone
 * who isn't staff can be made staff; a staff member's role can be changed
 * and their staff access removed.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import StaffAccessCard from './staff-access-card';

/** Mocked server actions. */
const { changeStaffRoleAction, removeFromStaffAction } = vi.hoisted(() => ({
  changeStaffRoleAction: vi.fn(),
  removeFromStaffAction: vi.fn(),
}));

vi.mock('../../../_people/staff-actions', () => ({ changeStaffRoleAction, removeFromStaffAction }));

describe('StaffAccessCard', () => {
  it('offers to make someone who isn’t staff a staff member', () => {
    render(<StaffAccessCard userId="user-1" userName="Ada Tester" staffRole={null} />);

    expect(screen.getByText('Not staff. Staff work with every company.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make staff' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove staff access' })).not.toBeInTheDocument();
  });

  it('lets a staff member’s role be changed and their staff access removed', () => {
    render(<StaffAccessCard userId="user-1" userName="Ada Tester" staffRole="support" />);

    expect(screen.getByText('Their staff role applies to every company.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role of Ada Tester' })).toHaveTextContent(
      'Support',
    );
    expect(screen.getByRole('button', { name: 'Remove staff access' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Make staff' })).not.toBeInTheDocument();
  });
});
