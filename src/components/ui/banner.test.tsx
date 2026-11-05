/**
 * @file Tests for the banner: its landmark name, the decorative icon in its
 * tone, the actions, and the optional dismiss button.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { describe, expect, it, vi } from 'vitest';

import Banner from './banner';

describe('Banner', () => {
  it('is a region named by its label, with the title and description', () => {
    render(
      <Banner
        label="Account security"
        icon={ShieldCheck}
        title="Protect your account"
        description="Add a passkey or two-step verification."
      />,
    );

    const banner = screen.getByRole('region', { name: 'Account security' });
    expect(banner).toHaveTextContent('Protect your account');
    expect(banner).toHaveTextContent('Add a passkey or two-step verification.');
  });

  it('hides the icon from assistive technology and tints it in its tone', () => {
    render(
      <Banner
        label="Users without MFA"
        icon={ShieldAlert}
        tone="danger"
        title="GitHub sign-in isn't configured"
        description="Some users have no MFA now."
      />,
    );

    const icon = screen.getByRole('region').querySelector('svg');
    expect(icon?.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.parentElement).toHaveClass('bg-danger-soft', 'text-danger');
  });

  it('is neutral by default', () => {
    render(<Banner label="Note" icon={ShieldCheck} title="Title" description="Description" />);

    const icon = screen.getByRole('region').querySelector('svg');
    expect(icon?.parentElement).toHaveClass('bg-muted', 'text-muted-foreground');
  });

  it('shows the actions, and no dismiss button unless it can be dismissed', () => {
    render(
      <Banner
        label="Users without MFA"
        icon={ShieldAlert}
        title="Title"
        description="Description"
        actions={<Link href="/admin/users?filter=without_mfa">See users without MFA</Link>}
      />,
    );

    expect(screen.getByRole('link', { name: 'See users without MFA' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has a dismiss button, named "Dismiss" by default, that calls onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <Banner
        label="Account security"
        icon={ShieldCheck}
        title="Title"
        description="Description"
        onDismiss={onDismiss}
      />,
    );

    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('names the dismiss button as asked', () => {
    render(
      <Banner
        label="Account security"
        icon={ShieldCheck}
        title="Title"
        description="Description"
        onDismiss={vi.fn()}
        dismissLabel="Dismiss the security tip"
      />,
    );

    expect(screen.getByRole('button', { name: 'Dismiss the security tip' })).toBeInTheDocument();
  });
});
