/**
 * @file Tests for the staff's name in client components: what the provider
 * hands down, and Adiutor's own name without one.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StaffNameProvider, useStaffName } from './staff-name';

/** Shows the name it's given. */
function Shown() {
  return <p>{useStaffName()}</p>;
}

describe('useStaffName', () => {
  it('gives the name the provider hands down', () => {
    render(
      <StaffNameProvider name="Adiutor Tests Support">
        <Shown />
      </StaffNameProvider>,
    );
    expect(screen.getByText('Adiutor Tests Support')).toBeInTheDocument();
  });

  it('gives Adiutor’s own name without a provider', () => {
    render(<Shown />);
    expect(screen.getByText('Adiutor')).toBeInTheDocument();
  });
});
