/**
 * @file Tests for the toast a page shows on arrival: shown once, also when
 * the page was hidden and is shown again, and afterwards the parameter that
 * asked for it is gone from the address, with the rest of it as it was.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { Activity } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from './toast';
import ToastOnArrival from './toast-on-arrival';

/**
 * Puts the browser at an address, as the redirect that leads to the page does.
 *
 * @param url - The page's address, e.g. `/requests/12?raised=1`.
 */
function arriveAt(url: string): void {
  window.history.replaceState(null, '', url);
}

/**
 * The address in the address bar, without its origin.
 *
 * @returns The path, the query and the section.
 */
function address(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

/**
 * The notifications region the toasts are in.
 *
 * @returns The region.
 */
const notifications = () => screen.getByRole('region', { name: /^Notifications/ });

afterEach(() => {
  vi.restoreAllMocks();
  arriveAt('/');
});

describe('ToastOnArrival', () => {
  it('toasts the message and takes its parameter out of the address', async () => {
    arriveAt('/requests/12?raised=1');

    render(
      <>
        <Toaster />
        <ToastOnArrival message="Request raised." param="raised" />
      </>,
    );

    await waitFor(() => expect(notifications()).toHaveTextContent('Request raised.'));
    expect(address()).toBe('/requests/12');
  });

  it('keeps every other parameter and the section, and adds no history entry', async () => {
    arriveAt('/admin/users?q=lee&deleted=1&page=2#users');
    const entries = window.history.length;
    const replaceState = vi.spyOn(window.history, 'replaceState');

    render(
      <>
        <Toaster />
        <ToastOnArrival message="User deleted." param="deleted" />
      </>,
    );

    await waitFor(() => expect(address()).toBe('/admin/users?q=lee&page=2#users'));
    expect(window.history.length).toBe(entries);
    // Without a state of its own, so Next copies its state and takes the address into its router.
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      null,
      '',
      '/admin/users?q=lee&page=2#users',
    );
  });

  it('takes only its own parameter, whatever its value', async () => {
    arriveAt('/account?language=saved&saved=1#language');

    render(
      <>
        <Toaster />
        <ToastOnArrival message="Language saved." param="language" />
      </>,
    );

    await waitFor(() => expect(address()).toBe('/account?saved=1#language'));
  });

  it('leaves an address without the parameter alone', async () => {
    arriveAt('/admin/users?page=2');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    render(
      <>
        <Toaster />
        <ToastOnArrival message="User deleted." param="deleted" />
      </>,
    );

    await waitFor(() => expect(notifications()).toHaveTextContent('User deleted.'));
    expect(replaceState).not.toHaveBeenCalled();
    expect(address()).toBe('/admin/users?page=2');
  });

  it('toasts once when its page was hidden and is shown again', async () => {
    arriveAt('/requests/12?raised=1');
    /**
     * The page with its toast, as Next keeps it: visible, or hidden in the background.
     *
     * @param props - Test props.
     * @param props.visible - Whether the page is shown.
     * @returns The page.
     */
    function Page({ visible }: { visible: boolean }) {
      return (
        <>
          <Toaster />
          <Activity mode={visible ? 'visible' : 'hidden'}>
            <ToastOnArrival message="Request raised." param="raised" />
          </Activity>
        </>
      );
    }
    const { rerender } = render(<Page visible />);
    await waitFor(() => expect(notifications()).toHaveTextContent('Request raised.'));

    rerender(<Page visible={false} />);
    rerender(<Page visible />);

    expect(screen.getAllByText('Request raised.')).toHaveLength(1);
    expect(address()).toBe('/requests/12');
  });

  it('confirms inline where there are no toasts', () => {
    arriveAt('/requests/12?raised=1');

    render(<ToastOnArrival message="Request raised." param="raised" />);

    expect(screen.getByRole('status')).toHaveTextContent('Request raised.');
  });
});
