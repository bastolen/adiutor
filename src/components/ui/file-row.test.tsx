/**
 * @file Tests for the file row: its thumbnail, or its icon when there's none
 * or it can't load, a video's play mark, the open button over the row with
 * its name for screen readers, a link instead without one, and the line and
 * actions that stay targets of their own.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FileRow from './file-row';

describe('FileRow', () => {
  it('opens the file from a button over the row, with its line and actions above it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(
      <FileRow
        name="error.png"
        detail={
          <>
            240 kB · <a href="#entry">Your reply</a>
          </>
        }
        icon={<svg data-testid="icon" />}
        thumbnail="/attachments/1/preview"
        onOpen={onOpen}
        openLabel="Open error.png, 240 kB"
        actions={<a href="#download">Download</a>}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open error.png, 240 kB' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Your reply' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
    // The thumbnail is decorative: the name says what it is.
    const thumbnail = container.querySelector('img');
    expect(thumbnail).toHaveAttribute('src', '/attachments/1/preview');
    expect(thumbnail).toHaveAttribute('alt', '');
    expect(screen.queryByTestId('icon')).toBeNull();
  });

  it('shows the icon when the thumbnail can’t load, and marks a video’s frame', () => {
    const { container, rerender } = render(
      <FileRow
        name="demo.webm"
        detail="90 kB"
        icon={<svg data-testid="icon" />}
        thumbnail="/attachments/2/preview"
        playMark
      />,
    );
    expect(container.querySelector('.lucide-play')).not.toBeNull();

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(container.querySelector('.lucide-play')).toBeNull();

    rerender(<FileRow name="logs.zip" detail="9 kB" icon={<svg data-testid="icon" />} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('links to the file without a way to open it', () => {
    render(
      <FileRow
        name="logs.zip"
        detail="9 kB"
        icon={<svg />}
        href="/attachments/3"
        linkLabel="Download logs.zip, 9 kB"
      />,
    );

    expect(screen.getByRole('link', { name: 'Download logs.zip, 9 kB' })).toHaveAttribute(
      'href',
      '/attachments/3',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
