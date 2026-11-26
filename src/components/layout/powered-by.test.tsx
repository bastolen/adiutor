/**
 * @file Tests for "Powered by Adiutor": shown once the staff have a name of
 * their own, and not while it's Adiutor's.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StaffNameProvider } from '@/components/brand/staff-name';

import PoweredBy from './powered-by';

describe('PoweredBy', () => {
  it('says Powered by Adiutor once the staff have a name of their own', () => {
    render(
      <StaffNameProvider name="Adiutor Tests Support">
        <PoweredBy />
      </StaffNameProvider>,
    );
    expect(screen.getByText('Powered by Adiutor')).toBeInTheDocument();
  });

  it('shows nothing while the staff’s name is Adiutor’s own', () => {
    const { container } = render(
      <StaffNameProvider name=" adiutor ">
        <PoweredBy />
      </StaffNameProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
