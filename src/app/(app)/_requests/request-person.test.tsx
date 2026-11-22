/**
 * @file Tests for showing who raised, wrote or changed something in a request.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RequestPerson } from '@/server/requests';

import PersonLine, { PeopleAvatars, PersonAvatar, personName } from './request-person';

/** The names of the two sides of a request. */
const NAMES = { company: 'Adiutor Tests Alpha', staff: 'Adiutor Tests' };

describe('personName', () => {
  it('is their own name, or their side’s without one', () => {
    expect(
      personName(
        { userId: null, name: 'Casey Client', side: 'company', isViewer: false, picture: null },
        NAMES,
      ),
    ).toBe('Casey Client');
    expect(
      personName(
        { userId: null, name: null, side: 'company', isViewer: false, picture: null },
        NAMES,
      ),
    ).toBe('Adiutor Tests Alpha');
    expect(
      personName(
        { userId: null, name: null, side: 'staff', isViewer: false, picture: null },
        NAMES,
      ),
    ).toBe('Adiutor Tests');
  });
});

describe('PersonLine', () => {
  it('shows someone at the company by name, and what follows it', () => {
    render(
      <PersonLine
        person={{
          userId: null,
          name: 'Casey Client',
          side: 'company',
          isViewer: false,
          picture: null,
        }}
        names={NAMES}
      >
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
      <PersonLine
        person={{
          userId: null,
          name: 'Sam Support',
          side: 'staff',
          isViewer: false,
          picture: null,
        }}
        names={NAMES}
      />,
    );

    expect(screen.getByText('Sam Support')).toBeInTheDocument();
    expect(screen.getByText('Adiutor Tests')).toBeInTheDocument();
  });

  it('leaves the label out where everyone listed is staff, and still says who the viewer is', () => {
    render(
      <PersonLine
        person={{ userId: null, name: 'Sam Support', side: 'staff', isViewer: true, picture: null }}
        names={NAMES}
        sideLabel={false}
      />,
    );

    expect(screen.getByText('Sam Support')).toBeInTheDocument();
    expect(screen.queryByText('Adiutor Tests')).not.toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('links the name to the user’s page for a reader who got their ID: the staff', () => {
    render(
      <PersonLine
        person={{
          userId: '0198a8c0-0000-7000-8000-000000000001',
          name: 'Casey Client',
          side: 'company',
          isViewer: false,
          picture: null,
        }}
        names={NAMES}
      />,
    );

    expect(screen.getByRole('link', { name: 'Casey Client' })).toHaveAttribute(
      'href',
      '/admin/users/0198a8c0-0000-7000-8000-000000000001',
    );
  });

  it('shows the name as plain text to everyone else', () => {
    render(
      <PersonLine
        person={{
          userId: null,
          name: 'Casey Client',
          side: 'company',
          isViewer: false,
          picture: null,
        }}
        names={NAMES}
      />,
    );

    expect(screen.getByText('Casey Client')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never links a side’s name, which would read like a link to the company', () => {
    render(
      <PersonLine
        person={{
          userId: '0198a8c0-0000-7000-8000-000000000001',
          name: null,
          side: 'company',
          isViewer: false,
          picture: null,
        }}
        names={NAMES}
      />,
    );

    expect(screen.getByText('Adiutor Tests Alpha')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('marks the reader', () => {
    render(
      <PersonLine
        person={{
          userId: null,
          name: 'Casey Client',
          side: 'company',
          isViewer: true,
          picture: null,
        }}
        names={NAMES}
      />,
    );

    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('shows the side’s name once for someone without a name or an account', () => {
    render(
      <PersonLine
        person={{ userId: null, name: null, side: 'staff', isViewer: false, picture: null }}
        names={NAMES}
      />,
    );

    expect(screen.getAllByText('Adiutor Tests')).toHaveLength(1);
  });
});

describe('PersonAvatar', () => {
  it('takes its initials from the name that is shown', () => {
    const { container, rerender } = render(
      <PersonAvatar
        person={{
          userId: null,
          name: 'Sam Support',
          side: 'staff',
          isViewer: false,
          picture: null,
        }}
        names={NAMES}
      />,
    );
    expect(container).toHaveTextContent('SS');

    rerender(
      <PersonAvatar
        person={{ userId: null, name: null, side: 'company', isViewer: false, picture: null }}
        names={NAMES}
      />,
    );
    expect(container).toHaveTextContent('AT');
  });

  it('shows their picture over the initials', () => {
    const { container } = render(
      <PersonAvatar
        person={{
          userId: null,
          name: 'Sam Support',
          side: 'staff',
          isViewer: false,
          picture: '/avatars/sam?v=1',
        }}
        names={NAMES}
      />,
    );

    expect(container.querySelector('img')).toHaveAttribute('src', '/avatars/sam?v=1');
    expect(container).toHaveTextContent('SS');
  });
});

describe('PeopleAvatars', () => {
  it('shows an avatar per person, each with the name on hover, hidden from screen readers', () => {
    const { container } = render(
      <PeopleAvatars
        people={[
          { userId: null, name: 'Morgan Manager', side: 'staff', isViewer: false, picture: null },
          { userId: null, name: null, side: 'staff', isViewer: false, picture: null },
        ]}
        names={NAMES}
      />,
    );

    const avatars = [...container.querySelectorAll('[title]')];
    // Someone without a name is shown by the staff's name, as everywhere in a request.
    expect(avatars.map((avatar) => avatar.getAttribute('title'))).toEqual([
      'Morgan Manager',
      'Adiutor Tests',
    ]);
    expect(avatars.map((avatar) => avatar.textContent)).toEqual(['MM', 'AT']);
    expect(avatars.every((avatar) => avatar.getAttribute('aria-hidden') === 'true')).toBe(true);
    // Everyone is shown: nothing says there are more.
    expect(container).not.toHaveTextContent('+');
  });

  it('says how many more people there are after the ones it shows', () => {
    const { container } = render(
      <PeopleAvatars
        people={[
          { userId: null, name: 'Casey Client', side: 'company', isViewer: false, picture: null },
        ]}
        names={NAMES}
        more="+3"
      />,
    );

    const more = screen.getByText('+3');
    // Like the avatars: for the eye, with the names given as text elsewhere.
    expect(more).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[title]')).toHaveLength(1);
  });

  it('keeps its row on one line, overlapping, unless asked to wrap it into aligned rows', () => {
    const people: RequestPerson[] = [
      { userId: null, name: 'Morgan Manager', side: 'staff', isViewer: false, picture: null },
      { userId: null, name: 'Sam Support', side: 'staff', isViewer: false, picture: null },
    ];
    const { container, rerender } = render(<PeopleAvatars people={people} names={NAMES} />);
    expect(container.firstElementChild).toHaveClass('-space-x-1');
    expect(container.firstElementChild).not.toHaveClass('flex-wrap');

    rerender(<PeopleAvatars people={people} names={NAMES} wrap />);

    // Side by side with a gap: an overlap's negative margin would shift each wrapped row.
    expect(container.firstElementChild).toHaveClass('flex-wrap', 'gap-1');
    expect(container.firstElementChild).not.toHaveClass('-space-x-1');
  });
});
