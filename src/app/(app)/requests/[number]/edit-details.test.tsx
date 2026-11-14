/**
 * @file Tests for the staff's "Edit details" dialog on a request's page.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';

import renderInLocale from '../../../../../tests/i18n/render';
import { updateDetailsAction } from './actions';
import EditDetails from './edit-details';

vi.mock('./actions', () => ({ updateDetailsAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  /**
   * Mocked router (the dialog's recent confirmation check uses it).
   *
   * @returns A router that goes nowhere.
   */
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  vi.mocked(updateDetailsAction).mockReset();
});

/** A request's details as they are. */
const DETAILS = { title: 'Help', type: 'bug', priority: 'normal' } as const;

/**
 * Opens the dialog.
 *
 * @param user - The user who clicks.
 * @returns The dialog.
 */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Edit details' }));
  return screen.getByRole('dialog', { name: 'Edit this request’s details' });
}

/**
 * Picks an option of one of the dialog's selects.
 *
 * @param user - The user who clicks.
 * @param select - The select's name.
 * @param option - The option's name.
 */
async function pick(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(screen.getByRole('option', { name: option }));
}

describe('EditDetails', () => {
  it('starts with the request’s details', async () => {
    const user = userEvent.setup();
    render(<EditDetails request={142} details={DETAILS} />);

    const dialog = await openDialog(user);

    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Help');
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveTextContent('Bug');
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Normal');
    expect(dialog).toHaveTextContent('The company doesn’t see the priority.');
  });

  it('saves the title, type and priority for its request', async () => {
    vi.mocked(updateDetailsAction).mockResolvedValue({ ok: true, message: 'Details saved.' });
    const user = userEvent.setup();
    render(<EditDetails request={142} details={DETAILS} />);

    const dialog = await openDialog(user);
    const title = within(dialog).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'The printer is broken');
    await pick(user, 'Priority', 'Low');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(updateDetailsAction).toHaveBeenCalledTimes(1));
    expect(
      Object.fromEntries(defined(vi.mocked(updateDetailsAction).mock.calls[0], 'the call')[1]),
    ).toEqual({ request: '142', title: 'The printer is broken', type: 'bug', priority: 'low' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('moves the priority to a newly picked type’s own', async () => {
    const user = userEvent.setup();
    render(<EditDetails request={142} details={DETAILS} />);

    const dialog = await openDialog(user);
    await pick(user, 'Type', 'Hotfix');
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('High');

    await pick(user, 'Type', 'New feature');
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Low');
  });

  it('leaves a priority that was picked by hand alone when the type changes', async () => {
    const user = userEvent.setup();
    render(<EditDetails request={142} details={DETAILS} />);

    const dialog = await openDialog(user);
    await pick(user, 'Priority', 'Low');
    await pick(user, 'Type', 'Hotfix');

    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Low');
  });

  it('shows a refusal in the dialog, which stays open with what was typed', async () => {
    vi.mocked(updateDetailsAction).mockResolvedValue({
      ok: false,
      message: 'Enter a title for the request.',
    });
    const user = userEvent.setup();
    render(<EditDetails request={142} details={DETAILS} />);

    const dialog = await openDialog(user);
    await pick(user, 'Type', 'Support');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Enter a title for the request.',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveTextContent('Support');
  });

  it('starts over with the saved details when it is opened again', async () => {
    const user = userEvent.setup();
    render(<EditDetails request={142} details={DETAILS} />);

    await openDialog(user);
    await pick(user, 'Type', 'Hotfix');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await openDialog(user);

    expect(within(dialog).getByRole('combobox', { name: 'Type' })).toHaveTextContent('Bug');
    expect(within(dialog).getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Normal');
  });

  it.each([
    ['nl-NL', 'Gegevens bewerken', 'Titel', 'Prioriteit', 'Gegevens opslaan'],
    ['es-ES', 'Editar datos', 'Título', 'Prioridad', 'Guardar datos'],
  ] as const)('speaks %s', async (locale, open, title, priority, save) => {
    const user = userEvent.setup();
    renderInLocale(locale, <EditDetails request={142} details={DETAILS} />);

    await user.click(screen.getByRole('button', { name: open }));

    expect(screen.getByRole('textbox', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: priority })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: save })).toBeInTheDocument();
  });
});
