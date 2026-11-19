/**
 * @file Tests for the formatting toolbar: what its buttons show and ask for,
 * the heading menu, and the dialog that takes a link's address.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FormattingToolbar, { type FormattingState } from './formatting-toolbar';

/** A cursor in plain text: nothing is on. */
const PLAIN: FormattingState = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: null,
  heading: 0,
  bulletList: false,
  orderedList: false,
  taskList: false,
  quote: false,
  codeBlock: false,
  codeLanguage: null,
  canNest: false,
  canLift: false,
};

/**
 * Renders the toolbar.
 *
 * @param state - What's on at the cursor, or `null` without an editor.
 * @returns The function the toolbar reports presses to.
 */
function renderToolbar(state: FormattingState | null = PLAIN) {
  const onCommand = vi.fn();
  render(<FormattingToolbar state={state} onCommand={onCommand} />);
  return onCommand;
}

describe('FormattingToolbar', () => {
  it('is a toolbar named for what it does, with a button for each kind of formatting', () => {
    renderToolbar();

    const toolbar = screen.getByRole('toolbar', { name: 'Formatting' });
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Bold',
      'Italic',
      'Strikethrough',
      'Code',
      'Link',
      'Heading',
      'Bullet list',
      'Numbered list',
      'List of things to do',
      'Nest the list item',
      'Lift the list item',
      'Quotation',
      'Block of code',
    ]);
  });

  it('switches every button off while there’s no editor to act on', () => {
    renderToolbar(null);

    screen.getAllByRole('button').forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('shows what’s on at the cursor', () => {
    renderToolbar({ ...PLAIN, bold: true, bulletList: true, link: 'https://adiutor.dev/' });

    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Bullet list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Link' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['Bold', 'bold'],
    ['Italic', 'italic'],
    ['Strikethrough', 'strike'],
    ['Code', 'code'],
    ['Bullet list', 'bulletList'],
    ['Numbered list', 'orderedList'],
    ['List of things to do', 'taskList'],
    ['Quotation', 'quote'],
    ['Block of code', 'codeBlock'],
  ])('asks for %s when its button is pressed', async (name, type) => {
    const user = userEvent.setup();
    const onCommand = renderToolbar();

    await user.click(screen.getByRole('button', { name }));

    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ type });
  });

  it('nests and lifts a list item only where that can be done', async () => {
    const user = userEvent.setup();
    const onCommand = renderToolbar({ ...PLAIN, bulletList: true, canNest: true });

    expect(screen.getByRole('button', { name: 'Lift the list item' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Nest the list item' }));

    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ type: 'nest' });
  });

  it('offers three headings and normal text, with the current one checked', async () => {
    const user = userEvent.setup();
    const onCommand = renderToolbar({ ...PLAIN, heading: 2 });

    await user.click(screen.getByRole('button', { name: 'Heading' }));
    const choices = screen.getAllByRole('menuitemradio');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      'Normal text',
      'Heading',
      'Subheading',
      'Small heading',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'Subheading' })).toBeChecked();

    await user.click(screen.getByRole('menuitemradio', { name: 'Normal text' }));
    // Once the menu has closed.
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledExactlyOnceWith({ type: 'heading', level: 0 }),
    );
  });

  it('shows a heading typed with more marks than it offers as its smallest', async () => {
    const user = userEvent.setup();
    renderToolbar({ ...PLAIN, heading: 5 });

    await user.click(screen.getByRole('button', { name: 'Heading' }));

    expect(screen.getByRole('menuitemradio', { name: 'Small heading' })).toBeChecked();
  });
});

describe('FormattingToolbar: the link dialog', () => {
  it('asks for a web address and links to it', async () => {
    const user = userEvent.setup();
    const onCommand = renderToolbar();

    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog', { name: 'Link' });
    // Nothing to remove where there's no link yet.
    expect(within(dialog).queryByRole('button', { name: 'Remove link' })).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Web address' }),
      'https://adiutor.dev/docs',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledExactlyOnceWith({
        type: 'link',
        address: 'https://adiutor.dev/docs',
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    'adiutor.dev',
    // eslint-disable-next-line no-script-url -- An address the dialog must refuse.
    'javascript:alert(1)',
    '/admin/staff',
    'mailto:user@adiutor.dev',
    '',
  ])('refuses "%s", which a text may not link to, and says why', async (address) => {
    const user = userEvent.setup();
    const onCommand = renderToolbar();

    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog', { name: 'Link' });
    if (address) {
      await user.type(within(dialog).getByRole('textbox', { name: 'Web address' }), address);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter a whole web address that starts with http:// or https://.',
    );
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('starts from the address of the link at the cursor, which can be removed', async () => {
    const user = userEvent.setup();
    const onCommand = renderToolbar({ ...PLAIN, link: 'https://adiutor.dev/old' });

    await user.click(screen.getByRole('button', { name: 'Link' }));
    const dialog = screen.getByRole('dialog', { name: 'Link' });
    expect(within(dialog).getByRole('textbox', { name: 'Web address' })).toHaveValue(
      'https://adiutor.dev/old',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Remove link' }));

    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledExactlyOnceWith({ type: 'link', address: null }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('doesn’t send the form the field is in when the address is saved', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <FormattingToolbar state={PLAIN} onCommand={vi.fn()} />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Web address' }),
      'https://adiutor.dev{Enter}',
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('FormattingToolbar: the language of a block of code', () => {
  /** Three languages to pick from. */
  const LANGUAGES = [
    { id: 'bash', name: 'Bash' },
    { id: 'python', name: 'Python' },
    { id: 'typescript', name: 'TypeScript' },
  ];

  /**
   * Names a language, also by its alias.
   *
   * @param language - The language as written.
   * @returns Its name, or `null` when it isn't one of the three.
   */
  const nameOf = (language: string) =>
    ({ bash: 'Bash', sh: 'Bash', python: 'Python', typescript: 'TypeScript', ts: 'TypeScript' })[
      language
    ] ?? null;

  /**
   * Renders the toolbar with the cursor in a block of code.
   *
   * @param codeLanguage - The language the block names, or `null`.
   * @param languages - The languages to pick from, or `null` before they've loaded.
   * @returns The function the toolbar reports presses to.
   */
  function renderInCode(
    codeLanguage: string | null,
    languages: typeof LANGUAGES | null = LANGUAGES,
  ) {
    const onCommand = vi.fn();
    render(
      <FormattingToolbar
        state={{ ...PLAIN, codeBlock: true, codeLanguage }}
        onCommand={onCommand}
        languages={languages}
        languageName={nameOf}
      />,
    );
    return onCommand;
  }

  it('isn’t offered outside a block of code, or before the languages are known', () => {
    renderToolbar();
    expect(screen.queryByRole('button', { name: /^Language:/ })).not.toBeInTheDocument();

    renderInCode('ts', null);
    expect(screen.queryByRole('button', { name: /^Language:/ })).not.toBeInTheDocument();
  });

  it('shows the block’s language by its name, also when it was typed as an alias', async () => {
    const user = userEvent.setup();
    renderInCode('ts');

    const button = screen.getByRole('button', { name: 'Language: TypeScript' });
    expect(button).toHaveTextContent('TypeScript');
    await user.click(button);

    expect(screen.getAllByRole('menuitemradio').map((choice) => choice.textContent)).toEqual([
      'No language',
      'Bash',
      'Python',
      'TypeScript',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'TypeScript' })).toBeChecked();
  });

  it('asks for the language that is picked, or for none', async () => {
    const user = userEvent.setup();
    const onCommand = renderInCode(null);

    await user.click(screen.getByRole('button', { name: 'Language: No language' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Python' }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledExactlyOnceWith({
        type: 'codeLanguage',
        language: 'python',
      }),
    );
  });

  it('takes the language off again', async () => {
    const user = userEvent.setup();
    const onCommand = renderInCode('python');

    await user.click(screen.getByRole('button', { name: 'Language: Python' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'No language' }));
    await waitFor(() =>
      expect(onCommand).toHaveBeenCalledExactlyOnceWith({ type: 'codeLanguage', language: null }),
    );
  });

  it('shows a language it doesn’t know as it was written', () => {
    renderInCode('mermaid');

    expect(screen.getByRole('button', { name: 'Language: mermaid' })).toBeInTheDocument();
  });
});
