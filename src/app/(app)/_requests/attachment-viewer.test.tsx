/**
 * @file Tests for the viewer of a request's files: a tile opens its file, an
 * image as it is, a PDF's large page (or its preview when there's no page),
 * an Office file's thumbnail, and an icon for a file it can't show; Previous
 * and Next step through every file on the request, also those without a
 * tile, each step said to screen readers; closing gives focus back to the
 * place it was opened from (the tile, or the Files card's row) for the file
 * shown last, else to the button it was opened with; the tile keeps a
 * Download button.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import renderInLocale from '../../../../tests/i18n/render';
import AttachmentViewer, { useFileOpener, type ViewableFile } from './attachment-viewer';
import ViewableAttachmentTile from './viewable-attachment-tile';

/** A screenshot, a PDF, an OpenDocument text and an archive, in the page's order. */
const FILES: ViewableFile[] = [
  { id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3a', name: 'error.png', size: 240_000, preview: true },
  { id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3b', name: 'invoice.pdf', size: 52_000, preview: true },
  { id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3c', name: 'notes.odt', size: 24_000, preview: true },
  { id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3d', name: 'logs.zip', size: 9_000, preview: false },
];

/**
 * A file's button in the Files card, as a plain button for these tests.
 *
 * @param props - Button props.
 * @param props.file - The file.
 */
function ListButton({ file }: { file: ViewableFile }) {
  const opener = useFileOpener(file.id, 'files');
  return (
    <button type="button" ref={opener?.ref} onClick={opener?.onOpen}>
      {`Open ${file.name} from the list`}
    </button>
  );
}

/**
 * The page's tiles, in a viewer.
 *
 * @param files - The request's files, which the viewer steps through.
 * @param options - Options.
 * @param options.tiles - The files with a tile on the page (all of them by default).
 * @param options.listed - The files with a button in the Files card (none by default).
 * @returns The rendered page.
 */
function renderPage(
  files: ViewableFile[] = FILES,
  { tiles = files, listed = [] }: { tiles?: ViewableFile[]; listed?: ViewableFile[] } = {},
) {
  return renderInLocale(
    'en-US',
    <AttachmentViewer files={files}>
      {listed.map((file) => (
        <ListButton key={file.id} file={file} />
      ))}
      <ul>
        {tiles.map((file) => (
          <li key={file.id}>
            <ViewableAttachmentTile
              id={file.id}
              name={file.name}
              detail="a size"
              icon={<span />}
              openLabel={`Open ${file.name}`}
              downloadLabel={`Download ${file.name}`}
            />
          </li>
        ))}
      </ul>
    </AttachmentViewer>,
  );
}

/**
 * The image the open viewer shows, by its alternative text.
 *
 * @param name - The file's name.
 * @returns The image.
 */
function shownImage(name: string): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('img', { name });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AttachmentViewer', () => {
  it('opens a file from its tile, which keeps a Download button of its own', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('link', { name: 'Download error.png' })).toHaveAttribute(
      'href',
      `/attachments/${FILES[0]?.id}`,
    );

    await user.click(screen.getByRole('button', { name: 'Open error.png' }));

    const dialog = screen.getByRole('dialog', { name: 'error.png' });
    expect(dialog).toHaveAccessibleDescription('1 of 4');
    expect(shownImage('error.png')).toHaveAttribute('src', `/attachments/${FILES[0]?.id}`);
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      `/attachments/${FILES[0]?.id}`,
    );
  });

  it('shows a PDF’s large page, and its preview for a PDF drawn before pages', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Open invoice.pdf' }));

    const page = shownImage('invoice.pdf');
    expect(page).toHaveAttribute('src', `/attachments/${FILES[1]?.id}/page`);
    expect(
      screen.getByText('The first page. Download the PDF to read all of it.'),
    ).toBeInTheDocument();
    fireEvent.error(page);
    await waitFor(() =>
      expect(shownImage('invoice.pdf')).toHaveAttribute(
        'src',
        `/attachments/${FILES[1]?.id}/preview`,
      ),
    );
  });

  it('steps through the page’s files, an Office file as its thumbnail and an archive as its icon', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Open invoice.pdf' }));

    await user.click(screen.getByRole('button', { name: 'Next file' }));
    expect(screen.getByRole('dialog', { name: 'notes.odt' })).toHaveAccessibleDescription('3 of 4');
    // Said to screen readers, as focus stays on Next.
    expect(screen.getByText('notes.odt: 3 of 4')).toHaveAttribute('aria-live', 'polite');
    expect(shownImage('notes.odt')).toHaveAttribute('src', `/attachments/${FILES[2]?.id}/preview`);

    await user.keyboard('{ArrowRight}');
    const archive = screen.getByRole('dialog', { name: 'logs.zip' });
    expect(within(archive).queryByRole('img')).toBeNull();
    expect(
      within(archive).getByText('This file can’t be shown here. Download it to open it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next file' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('dialog', { name: 'error.png' })).toBeInTheDocument();
  });

  it('gives focus to the tile of the file shown last when it closes', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Open error.png' }));
    await user.click(screen.getByRole('button', { name: 'Next file' }));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Open invoice.pdf' })).toHaveFocus();
  });

  it('gives focus back to the Files card when it was opened from there, not to the tile', async () => {
    const user = userEvent.setup();
    renderPage(FILES, { listed: FILES });
    await user.click(screen.getByRole('button', { name: 'Open error.png from the list' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Open error.png from the list' })).toHaveFocus();

    // After a step, to that place's button of the file shown last.
    await user.click(screen.getByRole('button', { name: 'Open error.png from the list' }));
    await user.keyboard('{ArrowRight}{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Open invoice.pdf from the list' })).toHaveFocus();
  });

  it('steps to files without a tile, and gives focus back to the button it was opened with', async () => {
    const user = userEvent.setup();
    renderPage(FILES, { tiles: FILES.slice(0, 2), listed: FILES.slice(0, 1) });
    await user.click(screen.getByRole('button', { name: 'Open invoice.pdf' }));

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'notes.odt' })).toHaveAccessibleDescription('3 of 4');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // notes.odt has no tile: back to the tile it was opened from, not the list's button.
    expect(screen.getByRole('button', { name: 'Open invoice.pdf' })).toHaveFocus();
  });

  it('shows a text file’s start as text, and says when the file goes on', async () => {
    vi.stubGlobal('fetch', async () => new Response('<b>printer</b> offline', { status: 206 }));
    const user = userEvent.setup();
    renderPage([
      {
        id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3e',
        name: 'printer.log',
        size: 900,
        preview: false,
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Open printer.log' }));

    const text = await screen.findByLabelText('printer.log, as text');
    // Only ever text: markup in it is shown as it is.
    expect(text).toHaveTextContent('<b>printer</b> offline');
    expect(text.querySelector('b')).toBeNull();
    expect(
      screen.getByText('Showing the start of the file. Download it to read all of it.'),
    ).toBeInTheDocument();
  });

  it('shows a text file’s icon when its text can’t be loaded', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }));
    const user = userEvent.setup();
    renderPage([
      { id: '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3e', name: 'printer.log', size: 15, preview: false },
    ]);

    await user.click(screen.getByRole('button', { name: 'Open printer.log' }));

    expect(
      await screen.findByText('The text couldn’t be loaded. Download the file to read it.'),
    ).toBeInTheDocument();
  });

  it('plays a video with its frame as the poster, and says so when it can’t play', async () => {
    const user = userEvent.setup();
    const id = '0197a3b2-7c41-7e2a-9f10-5b6c7d8e9f3f';
    renderPage([{ id, name: 'demo.webm', size: 90_000, preview: true }]);

    await user.click(screen.getByRole('button', { name: 'Open demo.webm' }));

    const video = within(screen.getByRole('dialog')).getByLabelText('demo.webm');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', `/attachments/${id}`);
    expect(video).toHaveAttribute('poster', `/attachments/${id}/preview`);
    expect(video).toHaveAttribute('controls');

    fireEvent.error(video);
    expect(
      await screen.findByText('This video can’t play in your browser. Download it to watch it.'),
    ).toBeInTheDocument();
  });
});
