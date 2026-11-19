/**
 * @file Tests for showing a text someone wrote in a request.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RequestText from './request-text';

describe('RequestText', () => {
  it('shows the text as written, with its line breaks and in its own direction', () => {
    const { container } = render(
      <RequestText
        id="text"
        text={{ text: 'Steps:\n\n1. Open the page\n2. Wait', format: 'plain' }}
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
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // What looks like markup is text.
    expect(screen.getByText(/<a href="x">y<\/a>/)).toBeInTheDocument();
  });

  it('takes extra classes for where it is shown', () => {
    const { container } = render(
      <RequestText id="text" text={{ text: 'Any news?', format: 'plain' }} className="bg-muted" />,
    );

    expect(container.querySelector('p')).toHaveClass('bg-muted', 'whitespace-pre-wrap');
  });

  it('leaves what looks like Markdown in a plain text as it was written', () => {
    const { container } = render(
      <RequestText id="text" text={{ text: '# Not a heading\n**not bold**', format: 'plain' }} />,
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
      <RequestText id="text" text={{ text, format: 'markdown' }} className="bg-muted" />,
    );

    expect(container.querySelector('blockquote')).not.toBeInTheDocument();
    const paragraph = container.querySelector('p');
    expect(paragraph?.textContent).toBe(`${text} (opens in a new tab)`);
    expect(paragraph).toHaveClass('bg-muted', 'whitespace-pre-wrap');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://adiutor.dev/docs');
  });
});
