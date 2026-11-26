/**
 * @file Tests for the note on a request a staff member raised for someone at
 * the company.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RequestPerson } from '@/server/requests';

import RaisedForNote from './raised-for-note';

/** The names of the two sides. */
const NAMES = { company: 'Adiutor Tests Alpha', staff: 'Adiutor Tests' };

/** The staff member who raised the request. */
const ANN: RequestPerson = {
  userId: null,
  name: 'Ann Staff',
  side: 'staff',
  isViewer: false,
  picture: null,
};

/** Who they raised it for, at the company. */
const CASEY: RequestPerson = {
  userId: null,
  name: 'Casey Client',
  side: 'company',
  isViewer: false,
  picture: null,
};

describe('RaisedForNote', () => {
  it.each([
    ['for someone else', ANN, CASEY, 'Ann Staff raised this for Casey Client'],
    ['for the reader', ANN, { ...CASEY, isViewer: true }, 'Ann Staff raised this for you'],
    ['by the reader', { ...ANN, isViewer: true }, CASEY, 'You raised this for Casey Client'],
    [
      'by a staff member whose account is gone',
      { ...ANN, name: null },
      CASEY,
      'Adiutor Tests raised this for Casey Client',
    ],
  ] as const)('words a request raised %s', (_name, staff, person, sentence) => {
    render(<RaisedForNote staff={staff} person={person} names={NAMES} />);

    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('follows the time with a separator, and stands alone without one', () => {
    const { container, rerender } = render(
      <RaisedForNote staff={ANN} person={CASEY} names={NAMES} />,
    );
    expect(container).toHaveTextContent(/^·/);

    rerender(<RaisedForNote staff={ANN} person={CASEY} names={NAMES} separated={false} />);
    expect(container).not.toHaveTextContent(/^·/);
  });
});
