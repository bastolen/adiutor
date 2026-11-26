/**
 * @file Tests for the account's Picture form: the pictures of the connected
 * accounts and the initials, each with its preview, an account without a
 * picture yet, a picture the reader doesn't get, the default until someone
 * chooses, and saving a choice.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignedInAsMarker } from '@/components/ui/signed-in-as';

import renderInLocale from '../../../../tests/i18n/render';
import { savePictureAction } from './actions';
import PictureForm, { type PictureOption } from './picture-form';

vi.mock('./actions', () => ({ savePictureAction: vi.fn() }));

afterEach(() => {
  vi.mocked(savePictureAction).mockReset();
});

/** A GitHub account with a picture. */
const GITHUB: PictureOption = {
  providerId: 'github',
  accountName: 'adiutor-tests',
  hasPicture: true,
  picture: '/avatars/github?v=1',
};

/** A Google account whose picture isn't known yet. */
const GOOGLE_WITHOUT_PICTURE: PictureOption = {
  providerId: 'google',
  accountName: 'ada@adiutor.test',
  hasPicture: false,
  picture: null,
};

/** A Google account with a picture the reader doesn't get (a staff member signed in as the user). */
const GOOGLE_NOT_FOR_READER: PictureOption = {
  providerId: 'google',
  accountName: null,
  hasPicture: true,
  picture: null,
};

describe('PictureForm', () => {
  it('offers each account’s picture and the initials, each with its preview', () => {
    const { container } = renderInLocale(
      'en-US',
      <PictureForm name="Ada Tester" options={[GITHUB]} shown="github" chosen />,
    );

    expect(screen.getByRole('group', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'GitHub · adiutor-tests' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Initials' })).not.toBeChecked();
    expect(container.querySelector('img')).toHaveAttribute('src', '/avatars/github?v=1');
    expect(screen.queryByText(/Until you choose/)).not.toBeInTheDocument();
  });

  it('offers an account without a picture yet, which can’t be chosen, and says what gives it one', () => {
    renderInLocale(
      'en-US',
      <PictureForm
        name="Ada Tester"
        options={[GITHUB, GOOGLE_WITHOUT_PICTURE]}
        shown="github"
        chosen={false}
      />,
    );

    const google = screen.getByRole('radio', { name: 'Google · ada@adiutor.test' });
    expect(google).toBeDisabled();
    expect(google).toHaveAccessibleDescription('Sign in with Google once to use its picture.');
    expect(
      screen.getByText(
        'Until you choose, the picture of the first account you connected that has one is shown.',
      ),
    ).toBeInTheDocument();
  });

  it('offers only the initials without a connected account, and where to connect one', () => {
    renderInLocale(
      'en-US',
      <PictureForm name="Ada Tester" options={[]} shown="initials" chosen={false} />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Initials' })).toBeChecked();
    expect(screen.getByRole('link', { name: 'Security page' })).toHaveAttribute(
      'href',
      '/account/security',
    );
  });

  it('saves the choice, and keeps it chosen', async () => {
    vi.mocked(savePictureAction).mockResolvedValue({ ok: true, message: 'Picture saved.' });
    const user = userEvent.setup();
    renderInLocale(
      'en-US',
      <PictureForm name="Ada Tester" options={[GITHUB]} shown="github" chosen={false} />,
    );

    await user.click(screen.getByRole('radio', { name: 'Initials' }));
    await user.click(screen.getByRole('button', { name: 'Save picture' }));

    await waitFor(() => expect(savePictureAction).toHaveBeenCalledOnce());
    const sent = vi.mocked(savePictureAction).mock.calls[0]?.[1];
    expect(sent instanceof FormData && sent.get('picture')).toBe('initials');
    expect(screen.getByRole('radio', { name: 'Initials' })).toBeChecked();
  });

  it('speaks Dutch', () => {
    renderInLocale(
      'nl-NL',
      <PictureForm name="Ada Tester" options={[GITHUB]} shown="github" chosen={false} />,
    );

    expect(screen.getByRole('radio', { name: 'Initialen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Foto opslaan' })).toBeInTheDocument();
  });

  it('turns everything off while a staff member is signed in as the user', () => {
    renderInLocale(
      'en-US',
      <>
        <PictureForm name="Ada Tester" options={[GITHUB]} shown="github" chosen />
        <SignedInAsMarker />
      </>,
    );

    expect(screen.getByRole('radio', { name: 'Initials' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save picture' })).toHaveAttribute('disabled');
  });

  it('shows initials for a picture the reader doesn’t get, without saying it has none', () => {
    const { container } = renderInLocale(
      'en-US',
      <>
        <PictureForm
          name="Ada Tester"
          options={[GITHUB, GOOGLE_NOT_FOR_READER]}
          shown="github"
          chosen
        />
        <SignedInAsMarker />
      </>,
    );

    // Only the picture in use loads; the other preview is the initials.
    expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      '/avatars/github?v=1',
    ]);
    expect(screen.getByRole('radio', { name: 'Google' })).not.toHaveAccessibleDescription(
      'Sign in with Google once to use its picture.',
    );
  });
});
