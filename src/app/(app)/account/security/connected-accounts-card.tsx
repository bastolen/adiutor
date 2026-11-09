/**
 * @file The connected accounts card on the Security page: signing in with
 * the configured OAuth providers (e.g. GitHub and Google), each connected
 * account named the way its owner knows it (a GitHub username, a Google
 * email address).
 */
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type MouseEvent, useId } from 'react';

import { useRecentConfirmation } from '@/components/auth/recent-confirmation';
import PROVIDER_ICONS from '@/components/brand/provider-icons';
import Alert from '@/components/ui/alert';
import Card from '@/components/ui/card';
import IconRow from '@/components/ui/icon-row';
import RowAction from '@/components/ui/row-action';
import formatDate from '@/lib/format';
import { type Locale } from '@/lib/i18n/locales';
import { type OAuthProvider, PROVIDER_LABELS, providerList } from '@/lib/sign-in/oauth-providers';
import type { ConnectedProvider } from '@/server/auth/accounts';

import type { AccountMessage } from '../account-messages';
import { confirmProviderAction, disconnectAction } from './actions';
import ConnectProviderButton from './connect-provider-button';

/** The card's anchor, which the step-up page comes back to (it renders the card itself). */
const SECTION = 'connected-accounts';

/**
 * Describes a connected account: when it was connected, and for one connected
 * while signing in with it, that it needs confirming (as a second step, when
 * it gives MFA: see `ConnectedProvider.givesMfa`).
 *
 * @param t - Translates the `account` namespace.
 * @param link - The connected account.
 * @param locale - The reader's language, for the date.
 * @returns The description.
 */
function describeLink(
  t: ReturnType<typeof useTranslations<'account'>>,
  link: ConnectedProvider,
  locale: Locale,
): string {
  const date = formatDate(link.connectedAt, locale);
  if (link.confirmed) {
    return t('security.connected.connectedOn', { date });
  }
  return link.givesMfa
    ? t('security.connected.unconfirmedMfa', { date })
    : t('security.connected.unconfirmed', { date });
}

/** A row of the card: a connected account, or a provider to connect. */
interface AccountRow {
  /** The provider. */
  provider: OAuthProvider;
  /** The connected account, or `null` for a Connect row. */
  link: ConnectedProvider | null;
  /**
   * Whether the row's controls also say when its account was connected: the
   * user has several accounts of this provider, and this one's name (unknown,
   * or the same as another's) doesn't tell it apart.
   */
  dated: boolean;
}

/**
 * Names a connected account in its controls' labels and dialog: by its name at
 * the provider when known, and by when it was connected when that's needed to
 * tell it apart ({@link AccountRow.dated}).
 *
 * @param t - Translates the `account` namespace.
 * @param link - The connected account.
 * @param dated - Whether to say when it was connected.
 * @param locale - The reader's language, for the date.
 * @returns E.g. "GitHub (octocat)", "GitHub (connected Oct 23, 2026)", or "GitHub".
 */
function accountLabel(
  t: ReturnType<typeof useTranslations<'account'>>,
  link: ConnectedProvider,
  dated: boolean,
  locale: Locale,
): string {
  const provider = PROVIDER_LABELS[link.provider];
  const account = link.accountName;
  if (dated) {
    const date = formatDate(link.connectedAt, locale);
    return account
      ? t('security.connected.accountNamedDated', { provider, account, date })
      : t('security.connected.accountDated', { provider, date });
  }
  return account ? t('security.connected.accountNamed', { provider, account }) : provider;
}

/**
 * Props for {@link ConnectedAccountsCard}.
 */
interface ConnectedAccountsCardProps {
  /**
   * How connecting an account went, after coming back from the provider
   * (`accountMessage`: `?connected=…` or Better Auth's `?error=…`), or `null`.
   */
  message?: AccountMessage | null;
  /** The providers configured on the server, in order. */
  providers: readonly OAuthProvider[];
  /** The user's connected provider accounts. */
  connected: readonly ConnectedProvider[];
  /**
   * Connected accounts (by ID) that can't be disconnected, because they give
   * the user the MFA their role requires (`mfaDowngradeBlocks`).
   */
  disconnectBlocked?: readonly string[];
  /** Why those can't be disconnected. */
  disconnectBlockedReason?: string;
  /**
   * Whether connecting another account is refused, because its MFA isn't
   * known until it's connected and it could take away the MFA the user's
   * role requires (`MfaDowngradeBlocks.connectProvider`).
   */
  connectBlocked?: boolean;
  /**
   * Accounts connected at sign-in (by ID) that can't be confirmed, because
   * counting them would take away the MFA the user's role requires
   * (`MfaDowngradeBlocks.confirm`, judged with each account's own MFA).
   */
  confirmBlocked?: readonly string[];
  /** Why those Connect and Confirm buttons are disabled. */
  connectBlockedReason?: string;
}

/**
 * Lists the user's provider accounts (one row each, so a second
 * account of the same provider, e.g. one connected while signing in with it,
 * can be confirmed or disconnected too), with each account's name at the
 * provider below the provider's when known, and a Connect button for each
 * configured provider without one. Connecting sends the user to the provider
 * and back to this card on the Security page, which then says how it went.
 * Connecting, confirming and disconnecting need a recent confirmation with
 * the second step (see `useRecentConfirmation`). Changes that would take away
 * the MFA the user's role requires are disabled, with the reason below (only
 * while a disabled control it explains is shown, and pointed at only by those
 * controls).
 *
 * @param props - Card props.
 * @param props.message - How connecting an account went, if the user just came back.
 * @param props.providers - Configured providers.
 * @param props.connected - Connected accounts.
 * @param props.disconnectBlocked - Accounts that can't be disconnected.
 * @param props.disconnectBlockedReason - Why.
 * @param props.connectBlocked - Whether connecting another account is refused.
 * @param props.confirmBlocked - Accounts connected at sign-in that can't be confirmed.
 * @param props.connectBlockedReason - Why those can't be connected or confirmed.
 * @returns The card.
 */
export default function ConnectedAccountsCard({
  message = null,
  providers,
  connected,
  disconnectBlocked = [],
  disconnectBlockedReason = '',
  connectBlocked = false,
  confirmBlocked = [],
  connectBlockedReason = '',
}: ConnectedAccountsCardProps) {
  const t = useTranslations('account');
  const locale = useLocale();
  const { askToConfirm } = useRecentConfirmation(SECTION);

  /**
   * Stops a change and sends the user to confirm it's them first, when
   * needed.
   *
   * @param event - The button's click.
   */
  const confirmFirst = (event: MouseEvent<HTMLButtonElement>) => {
    if (askToConfirm()) {
      event.preventDefault();
    }
  };
  const disconnectNoteId = useId();
  const connectNoteId = useId();
  // One row per connected account of a configured provider, and a Connect row for each without one.
  const rows = providers.flatMap((provider): AccountRow[] => {
    const links = connected.filter((link) => link.provider === provider);
    return links.length > 0
      ? links.map((link) => ({
          provider,
          link,
          dated:
            links.length > 1 &&
            (link.accountName === null ||
              links.some((other) => other !== link && other.accountName === link.accountName)),
        }))
      : [{ provider, link: null, dated: false }];
  });
  /**
   * Checks whether a row's Connect or Confirm button is shown disabled.
   *
   * @param link - The row's connected account, or `null` for a Connect row.
   * @returns Whether the row has such a button and it's disabled.
   */
  const connectOrConfirmBlocked = (link: ConnectedProvider | null) =>
    link === null ? connectBlocked : !link.confirmed && confirmBlocked.includes(link.id);
  // Each note only shows when a disabled control it explains is shown, and only those point at it.
  const disconnectNote =
    disconnectBlockedReason &&
    rows.some(({ link }) => link !== null && disconnectBlocked.includes(link.id))
      ? disconnectBlockedReason
      : null;
  const connectNote =
    connectBlockedReason && rows.some(({ link }) => connectOrConfirmBlocked(link))
      ? connectBlockedReason
      : null;
  const notes = [
    { id: disconnectNoteId, text: disconnectNote },
    { id: connectNoteId, text: connectNote },
  ].filter((note): note is { id: string; text: string } => note.text !== null);

  return (
    <Card
      id={SECTION}
      title={t('security.connected.title')}
      description={t('security.connected.description', {
        providers: providerList(providers, locale),
        count: providers.length,
      })}
      flush
    >
      {message && (
        <div className="px-6 pb-5">
          <Alert tone={message.tone} focusOnShow>
            {message.text}
          </Alert>
        </div>
      )}
      <ul className="divide-y divide-border border-t border-border">
        {rows.map(({ provider, link, dated }) => {
          const label = PROVIDER_LABELS[provider];
          const Icon = PROVIDER_ICONS[provider];
          // Accounts are told apart by their name at the provider, and when needed by date.
          const name = link ? accountLabel(t, link, dated, locale) : label;
          // The row's Connect or Confirm button, when it has one.
          const addBlocked = connectOrConfirmBlocked(link);
          const addDescribedBy = connectNote && addBlocked ? connectNoteId : undefined;
          return (
            <IconRow
              key={link?.id ?? provider}
              icon={<Icon />}
              title={label}
              subtitle={link?.accountName}
              control={
                link ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!link.confirmed && (
                      <RowAction
                        action={confirmProviderAction}
                        fields={{ accountId: link.id }}
                        label={t('security.connected.confirm')}
                        ariaLabel={t('security.connected.confirmNamed', { account: name })}
                        disabled={addBlocked}
                        describedBy={addDescribedBy}
                        onClick={confirmFirst}
                      />
                    )}
                    <RowAction
                      action={disconnectAction}
                      fields={{ accountId: link.id }}
                      label={t('security.connected.disconnect')}
                      ariaLabel={t('security.connected.disconnectNamed', { account: name })}
                      variant="danger-subtle"
                      disabled={disconnectBlocked.includes(link.id)}
                      describedBy={
                        disconnectNote && disconnectBlocked.includes(link.id)
                          ? disconnectNoteId
                          : undefined
                      }
                      onClick={confirmFirst}
                      confirm={{
                        title: t('security.connected.disconnectTitle', { account: name }),
                        description: t('security.connected.disconnectDescription', {
                          provider: label,
                        }),
                        confirmLabel: t('security.connected.disconnect'),
                      }}
                    />
                  </div>
                ) : (
                  <ConnectProviderButton
                    provider={provider}
                    label={label}
                    disabled={addBlocked}
                    describedBy={addDescribedBy}
                  />
                )
              }
            >
              {link ? describeLink(t, link, locale) : t('security.connected.notConnected')}
            </IconRow>
          );
        })}
      </ul>
      {notes.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border px-6 py-3">
          {notes.map((note) => (
            <p key={note.id} id={note.id} className="text-xs text-muted-foreground">
              {note.text}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
