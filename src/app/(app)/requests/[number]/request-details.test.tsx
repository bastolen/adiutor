/**
 * @file Tests for the Details card of a request's page.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestDetail } from '@/server/requests';

import { testLocale } from '../../../../../tests/i18n/next-intl-mocks';
import RequestDetails from './request-details';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T12:00:00Z'), toFake: ['Date'] });
  return () => vi.useRealTimers();
});

/**
 * A request as its page loads it.
 *
 * @param detail - What differs from an open bug a Client raised, as a Client sees it.
 * @returns The request.
 */
function detailOf(detail: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b',
    number: 142,
    prefix: 'AD',
    title: 'The printer is broken',
    description: { text: 'It prints blank pages.', format: 'plain' },
    type: 'bug',
    status: 'open',
    reopenedAt: null,
    priority: null,
    raisedBy: {
      userId: null,
      name: 'Casey Client',
      side: 'company',
      isViewer: true,
      picture: null,
    },
    assignees: [],
    subscribers: [],
    subscribed: false,
    createdAt: new Date('2026-11-13T09:00:00Z'),
    firstResponseAt: null,
    lastActivityAt: new Date('2026-11-13T11:55:00Z'),
    company: {
      id: 'company',
      name: 'Adiutor Tests Alpha',
      slug: 'adiutor-tests-alpha',
      deactivated: false,
    },
    permissions: new Set(),
    audience: 'contributor',
    staffName: 'Adiutor Tests',
    entries: [],
    earlierEntries: 0,
    ...detail,
  };
}

/**
 * Renders the card, which is an async server component.
 *
 * @param props - Its props.
 */
async function renderDetails(props: Parameters<typeof RequestDetails>[0]) {
  render(await RequestDetails(props));
}

/**
 * The value shown for a detail.
 *
 * @param term - The detail's name, e.g. "Status".
 * @returns The element with its value.
 */
function valueOf(term: string): HTMLElement {
  const name = screen.getByText(term, { selector: 'dt' });
  const value = name.nextElementSibling;
  if (!(value instanceof HTMLElement)) {
    throw new Error(`"${term}" has no value`);
  }
  return value;
}

describe('RequestDetails', () => {
  it('shows what a company user may know about the request, without a priority', async () => {
    await renderDetails({ detail: detailOf() });

    expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    expect(valueOf('Status')).toHaveTextContent('Open');
    expect(valueOf('Type')).toHaveTextContent('Bug');
    expect(
      within(valueOf('Company')).getByRole('link', { name: 'Adiutor Tests Alpha' }),
    ).toHaveAttribute('href', '/companies/adiutor-tests-alpha');
    expect(valueOf('Raised by')).toHaveTextContent('Casey Client');
    expect(valueOf('Raised by')).toHaveTextContent('You');
    expect(valueOf('Raised')).toHaveTextContent('Nov 13, 2026, 9:00 AM UTC');
    expect(valueOf('Last activity')).toHaveTextContent('5 minutes ago');
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
  });

  it('lists everyone it is assigned to, without the staff label, to everyone on the request', async () => {
    await renderDetails({
      detail: detailOf({
        assignees: [
          { userId: null, name: 'Morgan Manager', side: 'staff', isViewer: false, picture: null },
          { userId: null, name: 'Sam Support', side: 'staff', isViewer: false, picture: null },
        ],
      }),
    });

    const people = within(valueOf('Assigned to')).getAllByRole('listitem');
    // Each with their avatar; only staff are assigned, so nothing labels them as such.
    expect(people.map((item) => item.textContent)).toEqual(['MMMorgan Manager', 'SSSam Support']);
    expect(within(people[0] ?? document.body).getByText('MM')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    // Company users get no IDs, so no names link to a user's page.
    expect(within(valueOf('Assigned to')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says nobody is assigned yet', async () => {
    await renderDetails({ detail: detailOf() });

    expect(valueOf('Assigned to')).toHaveTextContent('Not assigned yet');
    expect(within(valueOf('Assigned to')).queryByRole('list')).not.toBeInTheDocument();
  });

  it('links the staff to the page of each person assigned, and puts their buttons below', async () => {
    await renderDetails({
      detail: detailOf({
        audience: 'staff',
        assignees: [
          { userId: 'sam-id', name: 'Sam Support', side: 'staff', isViewer: false, picture: null },
        ],
      }),
      assigneeControls: <button type="button">Assign to me</button>,
    });

    expect(
      within(valueOf('Assigned to')).getByRole('link', { name: 'Sam Support' }),
    ).toHaveAttribute('href', '/admin/users/sam-id');
    expect(
      within(valueOf('Assigned to')).getByRole('button', { name: 'Assign to me' }),
    ).toBeInTheDocument();
  });

  it('shows a reader at the company the subscribers from their company as avatars, with their names behind them', async () => {
    const user = userEvent.setup();
    await renderDetails({
      detail: detailOf({
        subscribers: [
          { userId: null, name: 'Casey Client', side: 'company', isViewer: true, picture: null },
          { userId: null, name: 'Wim Watcher', side: 'company', isViewer: false, picture: null },
        ],
        subscribed: true,
      }),
    });

    // Avatars only, each with the name on hover; the names are behind the button.
    const button = within(valueOf('Subscribers')).getByRole('button', {
      name: 'Show the 2 subscribers',
    });
    expect([...button.querySelectorAll('[title]')].map((avatar) => avatar.textContent)).toEqual([
      'CC',
      'WW',
    ]);
    expect(valueOf('Subscribers')).not.toHaveTextContent('Casey Client');

    await user.click(button);

    const people = within(screen.getByRole('dialog', { name: 'Subscribers' })).getAllByRole(
      'listitem',
    );
    expect(people).toHaveLength(2);
    expect(people[0]).toHaveTextContent('Casey Client');
    expect(people[0]).toHaveTextContent('You');
    expect(people[1]).toHaveTextContent('Wim Watcher');
    expect(within(screen.getByRole('dialog')).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the staff every subscriber by name, with a link each and no label for the staff', async () => {
    const user = userEvent.setup();
    await renderDetails({
      detail: detailOf({
        audience: 'staff',
        permissions: new Set(['requests:view', 'requests:view-internal']),
        subscribers: [
          {
            userId: 'casey',
            name: 'Casey Client',
            side: 'company',
            isViewer: false,
            picture: null,
          },
          { userId: 'fenna', name: 'Fenna Finance', side: 'staff', isViewer: false, picture: null },
        ],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Show the 2 subscribers' }));

    const panel = screen.getByRole('dialog', { name: 'Subscribers' });
    expect(within(panel).getByRole('link', { name: 'Fenna Finance' })).toHaveAttribute(
      'href',
      '/admin/users/fenna',
    );
    expect(within(panel).getByRole('link', { name: 'Casey Client' })).toHaveAttribute(
      'href',
      '/admin/users/casey',
    );
    // Names only: nothing labels who is on the staff.
    expect(panel).not.toHaveTextContent('Adiutor Tests');
  });

  it('shows at most four avatars, then how many more subscribers there are', async () => {
    const user = userEvent.setup();
    const names = ['Anna Admin', 'Bo Baker', 'Casey Client', 'Dee Doe', 'Eli East', 'Fay Field'];
    await renderDetails({
      detail: detailOf({
        subscribers: names.map((name) => ({
          userId: null,
          name,
          side: 'company' as const,
          isViewer: false,
          picture: null,
        })),
      }),
    });

    const button = within(valueOf('Subscribers')).getByRole('button', {
      name: 'Show the 6 subscribers',
    });
    expect([...button.querySelectorAll('[title]')].map((avatar) => avatar.textContent)).toEqual([
      'AA',
      'BB',
      'CC',
      'DD',
    ]);
    expect(button).toHaveTextContent('+2');

    // Everyone is behind it, also the ones without an avatar in the row.
    await user.click(button);
    expect(
      within(screen.getByRole('dialog', { name: 'Subscribers' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/^[A-Z]{2}/, '')),
    ).toEqual(names);
  });

  it('says one subscriber as one', async () => {
    await renderDetails({
      detail: detailOf({
        subscribers: [
          { userId: null, name: 'Casey Client', side: 'company', isViewer: false, picture: null },
        ],
      }),
    });

    expect(screen.getByRole('button', { name: 'Show the 1 subscriber' })).toBeInTheDocument();
  });

  it('says nobody is subscribed: at the company to its readers, at all to the staff', async () => {
    await renderDetails({ detail: detailOf() });
    expect(valueOf('Subscribers')).toHaveTextContent('Nobody at Adiutor Tests Alpha yet');
    expect(within(valueOf('Subscribers')).queryByRole('list')).not.toBeInTheDocument();
  });

  it('says nobody at all is subscribed to the staff, and puts the buttons below', async () => {
    await renderDetails({
      detail: detailOf({
        audience: 'staff',
        permissions: new Set(['requests:view', 'requests:view-internal']),
      }),
      subscriberControls: <button type="button">Subscribe</button>,
    });

    expect(valueOf('Subscribers')).toHaveTextContent('Nobody yet');
    expect(valueOf('Subscribers')).not.toHaveTextContent('Adiutor Tests Alpha');
    expect(
      within(valueOf('Subscribers')).getByRole('button', { name: 'Subscribe' }),
    ).toBeInTheDocument();
  });

  it('shows the staff the priority, under its own name', async () => {
    await renderDetails({ detail: detailOf({ priority: 'high', audience: 'staff' }) });

    expect(valueOf('Priority')).toHaveTextContent('High');
    expect(valueOf('Priority')).not.toHaveTextContent('High priority');
  });

  it('says a request was reopened, next to its status', async () => {
    await renderDetails({ detail: detailOf({ reopenedAt: new Date('2026-11-13T10:00:00Z') }) });

    expect(valueOf('Status')).toHaveTextContent('Open');
    expect(valueOf('Status')).toHaveTextContent('Reopened');
  });

  it('words a waiting request for whoever reads it', async () => {
    await renderDetails({ detail: detailOf({ status: 'waiting', audience: 'follower' }) });

    expect(valueOf('Status')).toHaveTextContent('Waiting for your company');
  });

  it('says how long the staff took to reply first, with the moment itself on hover', async () => {
    await renderDetails({
      detail: detailOf({ firstResponseAt: new Date('2026-11-13T11:00:00Z') }),
    });

    const response = within(valueOf('First response')).getByText('2 hours after it was raised');
    expect(response).toHaveAttribute('title', 'Nov 13, 2026, 11:00 AM UTC');
    expect(response).toHaveAttribute('datetime', '2026-11-13T11:00:00.000Z');
  });

  it('says the staff have not replied yet', async () => {
    await renderDetails({ detail: detailOf() });

    expect(valueOf('First response')).toHaveTextContent('Not yet');
  });

  it('has no first response for a request the staff raised themselves', async () => {
    await renderDetails({
      detail: detailOf({
        raisedBy: {
          userId: null,
          name: 'Sam Support',
          side: 'staff',
          isViewer: false,
          picture: null,
        },
      }),
    });

    expect(screen.queryByText('First response')).not.toBeInTheDocument();
    expect(valueOf('Raised by')).toHaveTextContent('Sam Support');
    expect(valueOf('Raised by')).toHaveTextContent('Adiutor Tests');
  });

  it('puts the staff’s status select in place of the status, and the controls under the details', async () => {
    await renderDetails({
      detail: detailOf({ reopenedAt: new Date('2026-11-13T10:00:00Z') }),
      statusControl: <button type="button">Pick a status</button>,
      controls: <button type="button">Edit details</button>,
    });

    expect(
      within(valueOf('Status')).getByRole('button', { name: 'Pick a status' }),
    ).toBeInTheDocument();
    // The select says the status itself; "Reopened" still stands next to it.
    expect(valueOf('Status')).toHaveTextContent('Reopened');
    expect(valueOf('Status')).not.toHaveTextContent('Open');
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
  });

  it('shows the status when a page has no control to put in its place', async () => {
    // What a page passes for someone who doesn't work on requests.
    await renderDetails({
      detail: detailOf({ status: 'done' }),
      statusControl: false,
      controls: false,
    });

    expect(valueOf('Status')).toHaveTextContent('Done');
  });

  it.each([
    [
      'nl-NL',
      ['Gegevens', 'Ingediend door', 'Eerste reactie', '2 uur na het indienen'],
      ['Abonnees', 'Nog niemand bij Adiutor Tests Alpha'],
    ],
    [
      'es-ES',
      ['Datos', 'Creada por', 'Primera respuesta', '2 horas después de crearla'],
      ['Suscriptores', 'Nadie de Adiutor Tests Alpha todavía'],
    ],
  ] as const)('speaks %s', async (locale, details, subscribing) => {
    const [heading, raisedBy, firstResponse, after] = details;
    const [subscribers, nobody] = subscribing;
    testLocale.current = locale;
    await renderDetails({
      detail: detailOf({ firstResponseAt: new Date('2026-11-13T11:00:00Z') }),
    });

    expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    expect(valueOf(raisedBy)).toHaveTextContent('Casey Client');
    expect(valueOf(firstResponse)).toHaveTextContent(after);
    expect(valueOf(subscribers)).toHaveTextContent(nobody);
  });
});
