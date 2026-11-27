/**
 * @file Tests for the file viewer: the file's name and place among the
 * files, Previous and Next (waiting, still focusable, at the ends; none for a
 * file on its own), the arrow keys (not while a video or a field has focus),
 * and Download.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FileViewer from './file-viewer';

/**
 * The viewer, open on a file in the middle or at an end.
 *
 * @param steps - What Previous and Next do; `null` at an end.
 * @param steps.previous - The step back.
 * @param steps.next - The step on.
 */
function renderViewer(steps: { previous: (() => void) | null; next: (() => void) | null }) {
  render(
    <FileViewer
      open
      onOpenChange={() => {}}
      name="error.png"
      position="2 of 3"
      steps={{
        previous: { label: 'Previous file', onStep: steps.previous },
        next: { label: 'Next file', onStep: steps.next },
      }}
      announcement=""
      detail="240 kB"
      download={{ href: '/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a', label: 'Download' }}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Only stands for what has focus; nothing plays. */}
      <video aria-label="The recording" />
      <input aria-label="A field" />
    </FileViewer>,
  );
}

describe('FileViewer', () => {
  it('names the file and its place, and downloads it', () => {
    renderViewer({ previous: null, next: null });
    const dialog = screen.getByRole('dialog', { name: 'error.png' });
    expect(dialog).toHaveAccessibleDescription('2 of 3');
    expect(screen.getByText('240 kB')).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download).toHaveAttribute('href', '/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a');
    expect(download).toHaveAttribute('download');
  });

  it('steps with Previous and Next, which wait at the ends but keep focus', async () => {
    const next = vi.fn();
    const user = userEvent.setup();
    renderViewer({ previous: null, next });

    await user.click(screen.getByRole('button', { name: 'Next file' }));
    expect(next).toHaveBeenCalledOnce();
    const previous = screen.getByRole('button', { name: 'Previous file' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    previous.focus();
    expect(previous).toHaveFocus();
  });

  it('steps with the arrow keys, unless a video or a field has focus', () => {
    const previous = vi.fn();
    const next = vi.fn();
    renderViewer({ previous, next });

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(next).toHaveBeenCalledOnce();
    expect(previous).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByLabelText('The recording'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'A field' }), { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(next).toHaveBeenCalledOnce();
  });

  it('has no Previous or Next for a file on its own', () => {
    render(
      <FileViewer
        open
        onOpenChange={() => {}}
        name="error.png"
        position="1 of 1"
        steps={null}
        announcement=""
        detail="240 kB"
        download={{ href: '/attachments/0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a', label: 'Download' }}
      >
        <p>The file</p>
      </FileViewer>,
    );
    expect(screen.queryByRole('button', { name: 'Next file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous file' })).toBeNull();
  });
});
