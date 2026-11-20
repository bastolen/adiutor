/**
 * @file Tests for showing a text someone wrote in a request.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../../tests/i18n/render';
import RequestText, { type TextSource } from './request-text';

/** The IDs the markers of three mentions name. */
const SAM = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b';
const CASEY = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7c';
const GONE = '019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7d';

/** The names of the two sides of the request the texts are in. */
const NAMES = { company: 'Adiutor Tests Alpha', staff: 'Adiutor Tests' };

/** Where the texts below are from: a reply by Sam in request 142. */
const SOURCE: TextSource = {
  url: 'https://adiutor.test/requests/142',
  writer: 'Sam Support',
  at: new Date('2026-11-18T23:30:00Z'),
};

describe('RequestText', () => {
  it('shows the text as written, with its line breaks and in its own direction', () => {
    const { container } = render(
      <RequestText
        id="text"
        text={{ text: 'Steps:\n\n1. Open the page\n2. Wait', format: 'plain' }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    const paragraph = container.querySelector('p');
    expect(paragraph).toHaveTextContent('Steps: 1. Open the page 2. Wait');
    expect(paragraph?.textContent).toBe('Steps:\n\n1. Open the page\n2. Wait');
    expect(paragraph).toHaveAttribute('dir', 'auto');
    expect(paragraph).toHaveClass('whitespace-pre-wrap', 'wrap-anywhere');
  });

  it('turns web addresses into links that open in a new tab and say so', () => {
    render(
      <RequestText
        id="text"
        text={{ text: 'See https://adiutor.dev/docs, then reply.', format: 'plain' }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    // The note is for screen readers only; jsdom drops the space before it from the name.
    const link = screen.getByRole('link', {
      name: /^https:\/\/adiutor\.dev\/docs ?\(opens in a new tab\)$/,
    });
    expect(link.textContent).toBe('https://adiutor.dev/docs (opens in a new tab)');
    expect(link).toHaveAttribute('href', 'https://adiutor.dev/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(screen.getByText(/, then reply\.$/)).toBeInTheDocument();
  });

  it('links nothing the writer did not spell out as a web address', () => {
    render(
      <RequestText
        id="text"
        text={{ text: 'adiutor.dev or javascript:alert(1) <a href="x">y</a>', format: 'plain' }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // What looks like markup is text.
    expect(screen.getByText(/<a href="x">y<\/a>/)).toBeInTheDocument();
  });

  it('takes extra classes for where it is shown', () => {
    const { container } = render(
      <RequestText
        id="text"
        text={{ text: 'Any news?', format: 'plain' }}
        className="bg-muted"
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(container.querySelector('p')).toHaveClass('bg-muted', 'whitespace-pre-wrap');
  });

  it('leaves what looks like Markdown in a plain text as it was written', () => {
    const { container } = render(
      <RequestText
        id="text"
        text={{ text: '# Not a heading\n**not bold**', format: 'plain' }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(container.querySelector('p')?.textContent).toBe('# Not a heading\n**not bold**');
  });

  it('formats a text written in Markdown', () => {
    const { container } = render(
      <RequestText
        id="text"
        text={{ text: '# Steps\n\n1. Open the **page**\n2. Wait', format: 'markdown' }}
        className="bg-muted"
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Steps' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('strong')).toHaveTextContent('page');
    expect(container.firstElementChild).toHaveClass('bg-muted');
  });

  it('shows a Markdown text that costs too much to format as it was written', () => {
    const text = `${'>'.repeat(500)} see https://adiutor.dev/docs`;
    const { container } = render(
      <RequestText
        id="text"
        text={{ text, format: 'markdown' }}
        className="bg-muted"
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(container.querySelector('blockquote')).not.toBeInTheDocument();
    const paragraph = container.querySelector('p');
    expect(paragraph?.textContent).toBe(`${text} (opens in a new tab)`);
    expect(paragraph).toHaveClass('bg-muted', 'whitespace-pre-wrap');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://adiutor.dev/docs');
  });

  it('copies code from a Markdown text below where it’s from: the request, its writer and the day', async () => {
    const user = userEvent.setup();
    render(
      <RequestText
        id="text"
        text={{ text: 'Run this:\n\n```bash\nnpm test\n```', format: 'markdown' }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy code' }));

    // The day is the one it was in UTC, as every date in Adiutor.
    expect(await navigator.clipboard.readText()).toBe(
      '# Source: https://adiutor.test/requests/142\n# Written by Sam Support on Nov 18, 2026\nnpm test',
    );
  });

  it.each([
    ['nl-NL', 'Bron', 'Geschreven door Sam Support op 18 nov 2026'],
    ['es-ES', 'Fuente', 'Escrito por Sam Support el 18 nov 2026'],
  ] as const)('writes that note in the reader’s language: %s', async (locale, source, written) => {
    const user = userEvent.setup();
    renderInLocale(
      locale,
      <RequestText
        id="text"
        text={{ text: '```sql\nselect 1;\n```', format: 'markdown' }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    await user.click(within(screen.getByRole('figure')).getByRole('button'));

    expect(await navigator.clipboard.readText()).toBe(
      `-- ${source}: https://adiutor.test/requests/142\n-- ${written}\nselect 1;`,
    );
  });
  it('names the people a Markdown text mentions as the page does: by name, or by their side', () => {
    const { container } = render(
      <RequestText
        id="text"
        text={{
          text: `Ask [@](mention:${SAM}) or [@](mention:${GONE}), [@](mention:${CASEY}).`,
          format: 'markdown',
          mentions: {
            [SAM]: {
              userId: null,
              name: 'Sam Support',
              side: 'staff',
              isViewer: false,
              picture: null,
            },
            // Someone whose account is gone is their side, as next to what they wrote.
            [GONE]: { userId: null, name: null, side: 'company', isViewer: false, picture: null },
            [CASEY]: {
              userId: null,
              name: 'Casey Client',
              side: 'company',
              isViewer: true,
              picture: null,
            },
          },
        }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(container.textContent).toBe('Ask @Sam Support or @Adiutor Tests Alpha, @Casey Client.');
    // The reader's own mention stands out; nobody is a link for someone at a company.
    expect(screen.getByText('@Casey Client')).toHaveClass('border-highlight');
    expect(screen.getByText('@Sam Support')).not.toHaveClass('border-highlight');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links a mention to the user’s page for a reader who got their ID, but never a side’s name', () => {
    render(
      <RequestText
        id="text"
        text={{
          text: `[@](mention:${SAM}) and [@](mention:${GONE})`,
          format: 'markdown',
          mentions: {
            [SAM]: {
              userId: 'sam-id',
              name: 'Sam Support',
              side: 'staff',
              isViewer: false,
              picture: null,
            },
            [GONE]: {
              userId: 'nameless-id',
              name: null,
              side: 'staff',
              isViewer: false,
              picture: null,
            },
          },
        }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    expect(screen.getByRole('link', { name: '@Sam Support' })).toHaveAttribute(
      'href',
      '/admin/users/sam-id',
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('@Adiutor Tests').tagName).toBe('SPAN');
  });

  it('names the people a text mentions also where it’s shown as it was written', () => {
    const text = `${'>'.repeat(500)} ask [@](mention:${SAM}), not [@](mention:${CASEY})`;
    const { container } = render(
      <RequestText
        id="text"
        text={{
          text,
          format: 'markdown',
          mentions: {
            [SAM]: {
              userId: null,
              name: 'Sam Support',
              side: 'staff',
              isViewer: false,
              picture: null,
            },
          },
        }}
        source={SOURCE}
        names={NAMES}
      />,
    );

    // A marker that isn't one of the text's stays what it is.
    expect(container.querySelector('p')?.textContent).toBe(
      `${'>'.repeat(500)} ask @Sam Support, not [@](mention:${CASEY})`,
    );
  });
});
