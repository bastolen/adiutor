/**
 * @file Tests for showing who raised, wrote or changed something in a request.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PersonLine, { PersonAvatar, personName } from './request-person';

/** The names of the two sides of a request. */
const NAMES = { company: 'Adiutor Tests Alpha', staff: 'Adiutor Tests' };

describe('personName', () => {
  it('is their own name, or their side’s without one', () => {
    expect(personName({ name: 'Casey Client', side: 'company', isViewer: false }, NAMES)).toBe(
      'Casey Client',
    );
    expect(personName({ name: null, side: 'company', isViewer: false }, NAMES)).toBe(
      'Adiutor Tests Alpha',
    );
    expect(personName({ name: null, side: 'staff', isViewer: false }, NAMES)).toBe('Adiutor Tests');
  });
});

describe('PersonLine', () => {
  it('shows someone at the company by name, and what follows it', () => {
    render(
      <PersonLine person={{ name: 'Casey Client', side: 'company', isViewer: false }} names={NAMES}>
        <span>2 hours ago</span>
      </PersonLine>,
    );

    expect(screen.getByText('Casey Client')).toBeInTheDocument();
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    expect(screen.queryByText('Adiutor Tests')).not.toBeInTheDocument();
    expect(screen.queryByText('You')).not.toBeInTheDocument();
  });

  it('labels the staff with the name they are shown with', () => {
    render(
      <PersonLine person={{ name: 'Sam Support', side: 'staff', isViewer: false }} names={NAMES} />,
    );

    expect(screen.getByText('Sam Support')).toBeInTheDocument();
    expect(screen.getByText('Adiutor Tests')).toBeInTheDocument();
  });

  it('marks the reader', () => {
    render(
      <PersonLine
        person={{ name: 'Casey Client', side: 'company', isViewer: true }}
        names={NAMES}
      />,
    );

    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows the side’s name once for someone without a name or an account', () => {
    render(<PersonLine person={{ name: null, side: 'staff', isViewer: false }} names={NAMES} />);

    expect(screen.getAllByText('Adiutor Tests')).toHaveLength(1);
  });
});

describe('PersonAvatar', () => {
  it('takes its initials from the name that is shown', () => {
    const { container, rerender } = render(
      <PersonAvatar
        person={{ name: 'Sam Support', side: 'staff', isViewer: false }}
        names={NAMES}
      />,
    );
    expect(container).toHaveTextContent('SS');

    rerender(
      <PersonAvatar person={{ name: null, side: 'company', isViewer: false }} names={NAMES} />,
    );
    expect(container).toHaveTextContent('AT');
  });
});
