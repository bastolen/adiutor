/**
 * @file Tests for the Markdown field when its editor can't be loaded: it
 * stays the plain text field it started as. (In unit tests the editor never
 * loads, see `vitest.setup.ts`.)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MarkdownField from './markdown-field';

describe('MarkdownField, when the editor can’t be loaded', () => {
  it('stays a plain text field that sends what’s typed', async () => {
    const { container } = render(
      <form>
        <MarkdownField label="Your reply" name="body" />
      </form>,
    );
    const field = screen.getByRole('textbox', { name: 'Your reply' });

    fireEvent.change(field, { target: { value: 'Still **Markdown**.' } });
    // Give the failed load its moment: nothing changes.
    await waitFor(() => expect(field).toBeInTheDocument());
    await Promise.resolve();

    expect(screen.getByRole('textbox', { name: 'Your reply' }).tagName).toBe('TEXTAREA');
    const form = container.querySelector('form') as HTMLFormElement;
    expect(new FormData(form).get('body')).toBe('Still **Markdown**.');
  });
});
