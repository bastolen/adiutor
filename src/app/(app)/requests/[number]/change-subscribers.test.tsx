/**
 * @file Tests for the "Change subscribers" dialog on a request's page.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../tests/i18n/render';
import { changeSubscribersAction } from './actions';
import ChangeSubscribers, { type SubscriberChoice } from './change-subscribers';

vi.mock('./actions', () => ({ changeSubscribersAction: vi.fn() }));

afterEach(() => {
  vi.mocked(changeSubscribersAction).mockReset();
});

/**
 * Someone the dialog offers.
 *
 * @param key - The key that stands for them.
 * @param name - Their name.
 * @param is - What differs from someone at the company who isn't subscribed.
 * @returns The choice.
 */
const choice = (
  key: string,
  name: string,
  is: Partial<SubscriberChoice> = {},
): SubscriberChoice => ({
  key,
  name,
  staff: false,
  subscribed: false,
  isViewer: false,
  ...is,
});

/** Who the staff can subscribe to a request: the company's people, and the staff. */
const EVERYONE = [
  choice('anna', 'Anna Admin'),
  choice('casey', 'Casey Client', { subscribed: true }),
  choice('fenna', 'Fenna Finance', { staff: true, subscribed: true }),
  choice('sam', 'Sam Support', { staff: true, isViewer: true }),
];

/**
 * What the action was sent last: each field with its values.
 *
 * @returns The form's fields.
 */
function sent(): Record<string, string[]> {
  const [, data] = defined(vi.mocked(changeSubscribersAction).mock.calls.at(-1), 'the last call');
  return Object.fromEntries(
    [...new Set(data.keys())].map((name) => [name, data.getAll(name).map(String)]),
  );
}

/**
 * Opens the dialog.
 *
 * @param user - The user who clicks.
 * @param names - The button's and the dialog's name, in English when left out.
 * @param names.button - The button's.
 * @param names.title - The dialog's.
 * @returns The dialog.
 */
async function openDialog(
  user: ReturnType<typeof userEvent.setup>,
  names = { button: 'Change subscribers', title: 'Change who’s subscribed' },
) {
  await user.click(screen.getByRole('button', { name: names.button }));
  return screen.getByRole('dialog', { name: names.title });
}

describe('ChangeSubscribers', () => {
  it('offers the staff the company’s people and the staff, the subscribers ticked', async () => {
    const user = userEvent.setup();
    render(
      <ChangeSubscribers
        request={142}
        choices={EVERYONE}
        company="Adiutor Tests Alpha"
        scope="everyone"
      />,
    );

    const dialog = await openDialog(user);

    const company = within(dialog).getByRole('group', { name: 'People at Adiutor Tests Alpha' });
    expect(within(company).getByRole('checkbox', { name: 'Anna Admin' })).not.toBeChecked();
    expect(within(company).getByRole('checkbox', { name: 'Casey Client' })).toBeChecked();
    const staff = within(dialog).getByRole('group', { name: 'Staff' });
    expect(within(staff).getByRole('checkbox', { name: 'Fenna Finance' })).toBeChecked();
    // The viewer is marked as themselves.
    expect(within(staff).getByRole('checkbox', { name: 'Sam Support (you)' })).not.toBeChecked();
    expect(dialog).toHaveTextContent(
      'The company sees which of its own people are subscribed, not which staff.',
    );
  });

  it('offers a company’s Admin their colleagues, in one group', async () => {
    const user = userEvent.setup();
    render(
      <ChangeSubscribers
        request={142}
        choices={[choice('anna', 'Anna Admin', { isViewer: true }), choice('wim', 'Wim Watcher')]}
        company="Adiutor Tests Alpha"
        scope="colleagues"
      />,
    );

    const dialog = await openDialog(user);

    expect(within(dialog).getAllByRole('group')).toHaveLength(1);
    expect(within(dialog).getByRole('checkbox', { name: 'Anna Admin (you)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Wim Watcher' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Everyone at your company sees who’s subscribed.');
    expect(dialog).not.toHaveTextContent('staff');
  });

  it('sends who is ticked with who was subscribed when it opened', async () => {
    vi.mocked(changeSubscribersAction).mockResolvedValue({
      ok: true,
      message: 'Subscribers saved.',
    });
    const user = userEvent.setup();
    render(
      <ChangeSubscribers
        request={142}
        choices={EVERYONE}
        company="Adiutor Tests Alpha"
        scope="everyone"
      />,
    );

    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('checkbox', { name: 'Anna Admin' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Fenna Finance' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save subscribers' }));

    await waitFor(() => expect(changeSubscribersAction).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({
      request: ['142'],
      subscriber: ['anna', 'casey'],
      was_subscriber: ['casey', 'fenna'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps what it opened with when the page behind it is refreshed, until it is opened again', async () => {
    vi.mocked(changeSubscribersAction).mockResolvedValue({
      ok: true,
      message: 'Subscribers saved.',
    });
    const user = userEvent.setup();
    const props = { request: 142, company: 'Adiutor Tests Alpha', scope: 'everyone' } as const;
    const { rerender } = render(<ChangeSubscribers {...props} choices={EVERYONE} />);

    const dialog = await openDialog(user);
    // Anna subscribed herself meanwhile, and the page behind the dialog shows it.
    const refreshed = EVERYONE.map((person) =>
      person.key === 'anna' ? { ...person, subscribed: true } : person,
    );
    rerender(<ChangeSubscribers {...props} choices={refreshed} />);

    // The editor left her alone, so nothing about her is sent as a change.
    expect(within(dialog).getByRole('checkbox', { name: 'Anna Admin' })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Save subscribers' }));
    await waitFor(() => expect(changeSubscribersAction).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({
      subscriber: ['casey', 'fenna'],
      was_subscriber: ['casey', 'fenna'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Opened again, it starts from the request as it is now.
    const reopened = await openDialog(user);
    expect(within(reopened).getByRole('checkbox', { name: 'Anna Admin' })).toBeChecked();
  });

  it.each([
    [
      'nl-NL',
      'Abonnees wijzigen',
      'Wijzigen wie geabonneerd is',
      'Medewerkers',
      'Sam Support (jij)',
    ],
    [
      'es-ES',
      'Cambiar suscriptores',
      'Cambiar quién tiene suscripción',
      'Personal',
      'Sam Support (tú)',
    ],
  ] as const)('speaks %s', async (locale, button, title, staffGroup, viewer) => {
    const user = userEvent.setup();
    renderInLocale(
      locale,
      <ChangeSubscribers
        request={142}
        choices={EVERYONE}
        company="Adiutor Tests Alpha"
        scope="everyone"
      />,
    );

    const dialog = await openDialog(user, { button, title });

    const staff = within(dialog).getByRole('group', { name: staffGroup });
    expect(within(staff).getByRole('checkbox', { name: viewer })).toBeInTheDocument();
  });
});
