/**
 * @file Tests for a request's file as a row in the Files card: inside the
 * page's viewer it opens the file there and has a Download button, and focus
 * comes back to it when the viewer closes; without a viewer it downloads the
 * file.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import renderInLocale from '../../../../tests/i18n/render';
import AttachmentViewer, { type ViewableFile } from './attachment-viewer';
import ViewableAttachmentRow from './viewable-attachment-row';

/** A screenshot on the request. */
const FILE: ViewableFile = {
  id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a',
  name: 'error.png',
  size: 240_000,
  preview: true,
};

/** The row for {@link FILE}. */
const row = (
  <ViewableAttachmentRow
    id={FILE.id}
    name={FILE.name}
    detail="240 kB"
    icon={<span />}
    thumbnail={`/attachments/${FILE.id}/preview`}
    openLabel="Open error.png, 240 kB"
    downloadLabel="Download error.png, 240 kB"
  />
);

describe('ViewableAttachmentRow', () => {
  it('opens its file in the viewer, which gives focus back to it, and downloads it', async () => {
    const user = userEvent.setup();
    renderInLocale('en-US', <AttachmentViewer files={[FILE]}>{row}</AttachmentViewer>);
    expect(screen.getByRole('link', { name: 'Download error.png, 240 kB' })).toHaveAttribute(
      'href',
      `/attachments/${FILE.id}`,
    );

    const open = screen.getByRole('button', { name: 'Open error.png, 240 kB' });
    await user.click(open);
    expect(screen.getByRole('dialog', { name: 'error.png' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(open).toHaveFocus();
  });

  it('downloads its file without a viewer on the page', () => {
    renderInLocale('en-US', row);

    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download error.png, 240 kB' })).toHaveAttribute(
      'href',
      `/attachments/${FILE.id}`,
    );
  });
});
