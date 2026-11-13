/**
 * @file Tests for the form that raises a request.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { REQUEST_TEXT_MAX_LENGTH, REQUEST_TITLE_MAX_LENGTH } from '@/lib/input-rules';

import renderInLocale from '../../../../../tests/i18n/render';
import raiseRequestAction from './actions';
import RaiseRequestForm from './raise-request-form';

vi.mock('./actions', () => ({ default: vi.fn() }));

afterEach(() => {
  vi.mocked(raiseRequestAction).mockReset();
});

/** One company to raise a request in. */
const ALPHA = [{ slug: 'adiutor-tests-alpha', name: 'Adiutor Tests Alpha' }];

/** Two companies to choose from. */
const BOTH = [...ALPHA, { slug: 'adiutor-tests-beta', name: 'Adiutor Tests Beta' }];

/**
 * What the action was sent.
 *
 * @returns The form's fields.
 */
const sent = () =>
  Object.fromEntries(defined(vi.mocked(raiseRequestAction).mock.calls.at(-1), 'the last call')[1]);

/**
 * Picks an option of one of the form's selects.
 *
 * @param user - The user who clicks.
 * @param select - The select's name.
 * @param option - The start of the option's name (it also holds its explanation).
 */
async function pick(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(screen.getByRole('option', { name: new RegExp(`^${option}`) }));
}

describe('RaiseRequestForm', () => {
  it('asks someone with one company for a title, a type and a description only', () => {
    render(<RaiseRequestForm companies={ALPHA} choosesPriority={false} />);

    expect(screen.queryByRole('combobox', { name: 'Company' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAttribute(
      'maxlength',
      String(REQUEST_TITLE_MAX_LENGTH),
    );
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent('Choose a type');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute(
      'maxlength',
      String(REQUEST_TEXT_MAX_LENGTH),
    );
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/requests');
  });

  it('says what each type is for', async () => {
    const user = userEvent.setup();
    render(<RaiseRequestForm companies={ALPHA} choosesPriority={false} />);

    await user.click(screen.getByRole('combobox', { name: 'Type' }));

    expect(
      screen.getAllByRole('option').map((option) => option.textContent?.replace(/\s+/g, ' ')),
    ).toEqual([
      expect.stringMatching(/^Hotfix\s*Something is broken and needs fixing right away\.$/),
      expect.stringMatching(/^Bug\s*Something doesn’t work as it should\.$/),
      expect.stringMatching(/^Support\s*A question, or help with something\.$/),
      expect.stringMatching(/^New feature\s*Something new, or a change to how things work\.$/),
    ]);
  });

  it('raises the request in the only company there is', async () => {
    const user = userEvent.setup();
    render(<RaiseRequestForm companies={ALPHA} choosesPriority={false} />);

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'The printer is broken');
    await pick(user, 'Type', 'Bug');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'It prints blank pages.');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));

    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(1));
    expect(sent()).toEqual({
      company: 'adiutor-tests-alpha',
      title: 'The printer is broken',
      type: 'bug',
      description: 'It prints blank pages.',
    });
  });

  it('lets someone with several companies choose one, starting with the one they came from', async () => {
    const user = userEvent.setup();
    render(
      <RaiseRequestForm companies={BOTH} company="adiutor-tests-beta" choosesPriority={false} />,
    );

    const company = screen.getByRole('combobox', { name: 'Company' });
    expect(company).toHaveTextContent('Adiutor Tests Beta');
    await pick(user, 'Company', 'Adiutor Tests Alpha');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'A question');
    await pick(user, 'Type', 'Support');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'How do I export?');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));

    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ company: 'adiutor-tests-alpha', type: 'support' });
  });

  it('asks for a company when none was chosen for them', () => {
    render(<RaiseRequestForm companies={BOTH} choosesPriority={false} />);

    expect(screen.getByRole('combobox', { name: 'Company' })).toHaveTextContent('Choose a company');
  });

  it('lets the staff leave the priority to the type, or choose one', async () => {
    const user = userEvent.setup();
    render(<RaiseRequestForm companies={ALPHA} choosesPriority />);

    const priority = screen.getByRole('combobox', { name: 'Priority' });
    expect(priority).toHaveTextContent('Set by the type');
    expect(priority).toHaveAccessibleDescription('Only staff see the priority.');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'The site is down');
    await pick(user, 'Type', 'Hotfix');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Since 9:00.');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));

    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(1));
    // Nothing chosen: the service takes the type's priority.
    expect(sent()).toMatchObject({ type: 'hotfix', priority: '' });

    await pick(user, 'Priority', 'Low');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));
    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(2));
    expect(sent()).toMatchObject({ priority: 'low' });
  });

  it('shows why a request was refused, and keeps what was typed', async () => {
    vi.mocked(raiseRequestAction).mockResolvedValue({
      ok: false,
      message: 'Choose what kind of request this is.',
    });
    const user = userEvent.setup();
    render(<RaiseRequestForm companies={ALPHA} choosesPriority={false} />);

    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.type(title, 'The printer is broken');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'It prints blank pages.');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose what kind of request this is.',
    );
    expect(title).toHaveValue('The printer is broken');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'It prints blank pages.',
    );
  });

  it.each([
    ['nl-NL', 'Titel', 'Beschrijving', 'Verzoek indienen', 'Kies een type'],
    ['es-ES', 'Título', 'Descripción', 'Crear solicitud', 'Elige un tipo'],
  ] as const)('speaks %s', (locale, title, description, submit, type) => {
    renderInLocale(locale, <RaiseRequestForm companies={ALPHA} choosesPriority={false} />);

    expect(screen.getByRole('textbox', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: description })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: submit })).toBeInTheDocument();
    expect(screen.getByText(type)).toBeInTheDocument();
  });
});
