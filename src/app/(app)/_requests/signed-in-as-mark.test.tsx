/**
 * @file Tests for the mark on request work a staff member did while signed in
 * as its author.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RequestPerson } from '@/server/requests';

import renderInLocale from '../../../../tests/i18n/render';
import SignedInAsMark from './signed-in-as-mark';

/** The names of the two sides. */
const NAMES = { company: 'Adiutor Tests Alpha', staff: 'Adiutor Tests' };

/** Someone at the company, who reads the page. */
const CASEY: RequestPerson = {
  userId: null,
  name: 'Casey Client',
  side: 'company',
  isViewer: true,
  picture: null,
};

describe('SignedInAsMark', () => {
  it('shows nothing for work the person did themselves', () => {
    const { container } = render(<SignedInAsMark mark={undefined} author={CASEY} names={NAMES} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['the reader’s work', CASEY, 'Ann Staff', 'work', 'Ann Staff did this while signed in as you'],
    [
      'the reader’s work, once the staff account is gone',
      CASEY,
      null,
      'work',
      'A staff member did this while signed in as you',
    ],
    [
      'someone else’s work',
      { ...CASEY, isViewer: false },
      'Ann Staff',
      'work',
      'Ann Staff did this while signed in as Casey Client',
    ],
    [
      'someone else’s work without a name',
      { ...CASEY, name: null, isViewer: false },
      null,
      'work',
      'A staff member did this while signed in as Adiutor Tests Alpha',
    ],
    [
      'the reader’s edit',
      CASEY,
      'Ann Staff',
      'edit',
      'Ann Staff made this edit while signed in as you',
    ],
    [
      'someone else’s edit',
      { ...CASEY, isViewer: false },
      null,
      'edit',
      'A staff member made this edit while signed in as Casey Client',
    ],
  ] as const)('words %s', (_name, author, staffName, kind, sentence) => {
    render(<SignedInAsMark mark={{ staffName }} author={author} names={NAMES} kind={kind} />);

    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('follows the time with a separator, and stands alone without one', () => {
    const { container, rerender } = render(
      <SignedInAsMark mark={{ staffName: 'Ann Staff' }} author={CASEY} names={NAMES} />,
    );
    expect(container).toHaveTextContent(/^·/);

    rerender(
      <SignedInAsMark
        mark={{ staffName: 'Ann Staff' }}
        author={CASEY}
        names={NAMES}
        separated={false}
      />,
    );
    expect(container).not.toHaveTextContent('·');
  });

  it('reads in the reader’s language', () => {
    renderInLocale(
      'nl-NL',
      <SignedInAsMark mark={{ staffName: 'Ann' }} author={CASEY} names={NAMES} />,
    );

    expect(screen.getByText('Gedaan door Ann, ingelogd als jou')).toBeInTheDocument();
  });
});
