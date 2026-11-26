/**
 * @file Tests for the form that raises a request.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defined } from '@/lib/defined';
import { REQUEST_TEXT_MAX_LENGTH, REQUEST_TITLE_MAX_LENGTH } from '@/lib/input-rules';

import renderInLocale from '../../../../../tests/i18n/render';
import raiseRequestAction, { raiseForChoicesAction } from './actions';
import RaiseRequestForm from './raise-request-form';

vi.mock('./actions', () => ({ default: vi.fn(), raiseForChoicesAction: vi.fn() }));
// The list of people at "@" is asked from the server, which isn't here.
vi.mock('../../_requests/mention-actions', () => ({ mentionChoicesAction: vi.fn() }));

afterEach(() => {
  vi.mocked(raiseRequestAction).mockReset();
  vi.mocked(raiseForChoicesAction).mockReset();
});

/** The people of Adiutor Tests Alpha a request can be raised for. */
const ALPHA_PEOPLE = [
  { key: 'casey-key', name: 'Casey Client' },
  { key: 'anna-key', name: 'Anna Admin' },
];

/** One company to raise a request in. */
const ALPHA = [{ slug: 'adiutor-tests-alpha', name: 'Adiutor Tests Alpha' }];

/** The types to choose from, as the page gives them: the ones that aren't archived. */
const TYPES = [
  {
    key: 'hotfix',
    name: 'Hotfix',
    description: 'Something is broken and needs fixing right away.',
  },
  { key: 'bug', name: 'Bug', description: 'Something doesn’t work as it should.' },
  { key: 'support', name: 'Support', description: 'A question, or help with something.' },
  {
    key: 'new_feature',
    name: 'New feature',
    description: 'Something new, or a change to how things work.',
  },
];

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
    render(<RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />);

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
    render(<RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />);

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
    render(<RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />);

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
      <RaiseRequestForm
        types={TYPES}
        companies={BOTH}
        company="adiutor-tests-beta"
        choosesPriority={false}
      />,
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

  it('tells two companies with the same name apart by their URL names', async () => {
    const user = userEvent.setup();
    const twins = [
      { slug: 'adiutor-tests', name: 'Adiutor Tests' },
      { slug: 'adiutor-tests-north', name: 'Adiutor Tests' },
      ...ALPHA,
    ];
    render(<RaiseRequestForm types={TYPES} companies={twins} choosesPriority={false} />);

    await user.click(screen.getByRole('combobox', { name: 'Company' }));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Adiutor Tests (adiutor-tests)',
      'Adiutor Tests (adiutor-tests-north)',
      'Adiutor Tests Alpha',
    ]);
  });

  it('asks for a company when none was chosen for them', () => {
    render(<RaiseRequestForm types={TYPES} companies={BOTH} choosesPriority={false} />);

    expect(screen.getByRole('combobox', { name: 'Company' })).toHaveTextContent('Choose a company');
  });

  it('sends no company while none is chosen, and says which field is missing', async () => {
    vi.mocked(raiseRequestAction).mockResolvedValue({
      ok: false,
      message: 'Choose which company this request is for.',
    });
    const user = userEvent.setup();
    render(<RaiseRequestForm types={TYPES} companies={BOTH} choosesPriority={false} />);

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'A question');
    await pick(user, 'Type', 'Support');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'How do I export?');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));

    // An empty company, which the service answers as a field to fill in.
    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ company: '', title: 'A question' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose which company this request is for.',
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('A question');
  });

  it('lets the staff leave the priority to the type, or choose one', async () => {
    const user = userEvent.setup();
    render(<RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority />);

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

  it('lets the staff raise it for someone at the company who asked, or for themselves', async () => {
    const user = userEvent.setup();
    render(
      <RaiseRequestForm
        types={TYPES}
        companies={ALPHA}
        choosesPriority
        raisesFor
        raiseForChoices={ALPHA_PEOPLE}
      />,
    );

    const raiseFor = screen.getByRole('combobox', { name: 'Raise it for' });
    expect(raiseFor).toHaveTextContent('Yourself');
    expect(raiseFor).toHaveAccessibleDescription(
      'Someone at the company who asked you, for example by phone. They show as who raised it, follow it and get an email.',
    );
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'The printer is broken');
    await pick(user, 'Type', 'Bug');
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'They called.');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));

    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(1));
    // Nobody chosen: the staff member raises it.
    expect(sent()).toMatchObject({ raised_for: '' });

    await pick(user, 'Raise it for', 'Casey Client');
    await user.click(screen.getByRole('button', { name: 'Raise request' }));
    await waitFor(() => expect(raiseRequestAction).toHaveBeenCalledTimes(2));
    expect(sent()).toMatchObject({ raised_for: 'casey-key' });
    // Nothing is asked of the server for the company chosen already.
    expect(raiseForChoicesAction).not.toHaveBeenCalled();
  });

  it('asks who it can be raised for when the staff choose another company, from themselves again', async () => {
    /** Answers the form's question for the people of the company it chose. */
    let answer: (people: typeof ALPHA_PEOPLE) => void = () => {};
    vi.mocked(raiseForChoicesAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <RaiseRequestForm
        types={TYPES}
        companies={BOTH}
        company="adiutor-tests-beta"
        choosesPriority
        raisesFor
        raiseForChoices={[{ key: 'bea-key', name: 'Bea Beta' }]}
      />,
    );
    await pick(user, 'Raise it for', 'Bea Beta');

    await pick(user, 'Company', 'Adiutor Tests Alpha');

    expect(raiseForChoicesAction).toHaveBeenCalledExactlyOnceWith('adiutor-tests-alpha');
    const raiseFor = screen.getByRole('combobox', { name: 'Raise it for' });
    expect(raiseFor).toHaveTextContent('Yourself');
    expect(raiseFor).toHaveAttribute('aria-busy', 'true');
    answer(ALPHA_PEOPLE);
    await waitFor(() => expect(raiseFor).not.toHaveAttribute('aria-busy'));
    await user.click(raiseFor);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Yourself',
      'Casey Client',
      'Anna Admin',
    ]);
  });

  it('keeps the people of the company chosen last, whichever answer comes first', async () => {
    const answers = new Map<string, (people: typeof ALPHA_PEOPLE) => void>();
    vi.mocked(raiseForChoicesAction).mockImplementation(
      (company) =>
        new Promise((resolve) => {
          answers.set(String(company), resolve);
        }),
    );
    const user = userEvent.setup();
    render(<RaiseRequestForm types={TYPES} companies={BOTH} choosesPriority raisesFor />);

    await pick(user, 'Company', 'Adiutor Tests Alpha');
    await pick(user, 'Company', 'Adiutor Tests Beta');
    answers.get('adiutor-tests-beta')?.([{ key: 'bea-key', name: 'Bea Beta' }]);
    // Alpha's answer comes late, for a company that's no longer chosen.
    answers.get('adiutor-tests-alpha')?.(ALPHA_PEOPLE);

    const raiseFor = screen.getByRole('combobox', { name: 'Raise it for' });
    await waitFor(() => expect(raiseFor).not.toHaveAttribute('aria-busy'));
    await user.click(raiseFor);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Yourself',
      'Bea Beta',
    ]);
  });

  it('offers the staff Internal first in the Company select, even with one company, and says only they see it', async () => {
    const user = userEvent.setup();
    render(
      <RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority raisesInternal raisesFor />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Company' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Internal',
      'Adiutor Tests Alpha',
    ]);
    await user.click(screen.getByRole('option', { name: 'Internal' }));

    expect(screen.getByText('Only the staff see an internal request.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Raise it for' })).not.toBeInTheDocument();
  });

  it('keeps only a hidden company field for one company when no internal request can be raised', () => {
    const { container } = render(
      <RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />,
    );

    expect(screen.queryByRole('combobox', { name: 'Company' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="hidden"][name="company"]')).toHaveValue(
      'adiutor-tests-alpha',
    );
  });

  it('lets nobody else raise it for someone', () => {
    render(<RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />);

    expect(screen.queryByRole('combobox', { name: 'Raise it for' })).not.toBeInTheDocument();
  });

  it('shows why a request was refused, and keeps what was typed', async () => {
    vi.mocked(raiseRequestAction).mockResolvedValue({
      ok: false,
      message: 'Choose what kind of request this is.',
    });
    const user = userEvent.setup();
    render(<RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />);

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
    renderInLocale(
      locale,
      <RaiseRequestForm types={TYPES} companies={ALPHA} choosesPriority={false} />,
    );

    expect(screen.getByRole('textbox', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: description })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: submit })).toBeInTheDocument();
    expect(screen.getByText(type)).toBeInTheDocument();
  });
});
