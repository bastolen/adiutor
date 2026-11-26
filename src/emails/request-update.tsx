/**
 * @file Email telling someone on a request what happened to it: who replied,
 * with the reply, who changed its status, and what put them on it (assigned
 * to them, a text that mentions them, someone who subscribed them). Several
 * pieces of news about one request are one email. A text's files are named
 * under it, never attached or linked: the request's page downloads them.
 */
import type { ReactNode } from 'react';
import { Link, Section, Text } from 'react-email';

import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import EmailMarkdown, { type EmailText } from '@/components/email/email-markdown';
import { EmailHeading, EmailNote, EmailParagraph } from '@/components/email/email-text';
import { colors, small } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import { formatFileSize } from '@/lib/format';
import type { Locale } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import {
  type RequestAudience,
  type RequestParticipantRole,
  type RequestSide,
  type RequestStatus,
  statusChangeKind,
} from '@/lib/requests';
import { REQUEST_LINK_DAYS } from '@/lib/sign-in/request-link';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/** A text the email shows, with the people it mentions by name and the files attached to it. */
export interface RequestUpdateEmailText extends EmailText {
  /** The files attached to it, oldest first: named, never attached or linked. */
  attachments?: readonly { name: string; size: number }[];
}

/** One thing the email tells its reader. Each names who did it, as the request's page names them. */
export type RequestUpdateEmailItem =
  | {
      /** Someone replied. */
      event: 'reply';
      /** Who. */
      by: string;
      /** The reply, with the people it mentions by name and its files. */
      text: RequestUpdateEmailText;
    }
  | {
      /** Someone wrote an internal note: only ever in an email to the staff. */
      event: 'note';
      /** Who. */
      by: string;
      /** The note, with the people it mentions by name and its files. */
      text: RequestUpdateEmailText;
    }
  | {
      /** Someone changed the status. */
      event: 'status';
      /** Who. */
      by: string;
      /** The side they changed it as: the company's answer to a solution reads differently. */
      bySide: RequestSide;
      /** The status it had. */
      from: RequestStatus;
      /** The status it got. */
      to: RequestStatus;
    }
  | {
      /** Someone assigned the request to the reader. */
      event: 'assigned';
      /** Who. */
      by: string;
    }
  | {
      /** Someone mentioned the reader. */
      event: 'mentioned';
      /** Who. */
      by: string;
      /** Where: in the request's description, a reply, or an internal note (for the staff). */
      where: 'description' | 'reply' | 'note';
      /** The text that mentions them, with its files. */
      text: RequestUpdateEmailText;
    }
  | {
      /** Someone subscribed the reader to the request. */
      event: 'subscribed';
      /** Who. */
      by: string;
    };

/**
 * Props for {@link RequestUpdateEmail}.
 */
export interface RequestUpdateEmailProps extends EmailBaseProps {
  /** The request's number as people see it, e.g. "AD-142". */
  reference: string;
  /** The request's title. */
  title: string;
  /** The name of the request's company. */
  companyName: string;
  /**
   * The reader's link that signs them in to Adiutor and opens the request
   * (`requestLinkPath`, decision 0036).
   */
  url: string;
  /** Why the reader gets the email: the request is assigned to them, or they're subscribed. */
  role: RequestParticipantRole;
  /** How to word the request's statuses for the reader. */
  audience: RequestAudience;
  /** What happened, in the order it happened. */
  items: readonly RequestUpdateEmailItem[];
  /**
   * The reader's links that approve or deny the solution the email tells of
   * (decision 0033): only for someone at the company who may answer it.
   */
  answerLinks?: { approve: string; deny: string };
}

/**
 * Makes a name stand out in a sentence, for the `<strong>` tag of a message.
 *
 * @param chunks - The name.
 * @returns It, in bold.
 */
function strongTag(chunks: ReactNode) {
  return <strong>{chunks}</strong>;
}

/**
 * The link to the request, for the `<link>` tag of a message.
 *
 * @param href - The request's address.
 */
function requestLinkTag(href: string) {
  return function linkTag(chunks: ReactNode) {
    return (
      <Link href={href} style={{ color: colors.primary, fontWeight: 600 }}>
        {chunks}
      </Link>
    );
  };
}

/**
 * Where someone turns emails about requests off: their account's Preferences
 * tab, at its card for them.
 */
export const REQUEST_EMAILS_PATH = '/account/preferences#request-emails';

/**
 * The link to the account's setting, for the `<account>` tag of the footer.
 *
 * @param href - The setting's address.
 */
function accountLinkTag(href: string) {
  return function accountTag(chunks: ReactNode) {
    return (
      <Link href={href} style={{ color: colors.muted, textDecoration: 'underline' }}>
        {chunks}
      </Link>
    );
  };
}

/**
 * A text someone wrote, set apart from the email's own words by a line on
 * its left, formatted as on the request's page (`EmailMarkdown`), with the
 * names and sizes of its files below it.
 *
 * @param props - Component props.
 * @param props.text - The text.
 * @param props.id - A name no other text in the email has.
 * @param props.locale - The email's language.
 * @param props.appUrl - Adiutor's own address, for a text the company reads (its links to the
 *   staff's pages show as text); `null` for an internal note.
 */
function WrittenText({
  text,
  id,
  locale,
  appUrl,
}: {
  text: RequestUpdateEmailText;
  id: string;
  locale: Locale;
  appUrl: string | null;
}) {
  const t = translator(locale, 'emails.requestUpdate');
  const files = text.attachments ?? [];
  return (
    <Section
      style={{
        borderLeft: `3px solid ${colors.border}`,
        margin: '0 0 20px',
        padding: '0 0 0 16px',
      }}
    >
      <EmailMarkdown value={text} id={id} locale={locale} appUrl={appUrl} />
      {files.length > 0 && (
        <>
          <Text style={{ ...small, margin: '4px 0' }}>{t('files', { count: files.length })}</Text>
          {files.map((file, index) => (
            // eslint-disable-next-line react/no-array-index-key -- a fixed list, rendered once; names can repeat
            <Text key={index} style={{ ...small, margin: '0', overflowWrap: 'anywhere' }}>
              {t('file', { name: file.name, size: formatFileSize(file.size, locale) })}
            </Text>
          ))}
        </>
      )}
    </Section>
  );
}

/**
 * One piece of news: a sentence that says who did what, and for a reply or
 * a mention the text itself.
 *
 * @param props - Component props.
 * @param props.item - The news.
 * @param props.id - A name no other piece of news in the email has, for its text.
 * @param props.audience - How to word the request's statuses for the reader.
 * @param props.locale - The email's language.
 * @param props.appUrl - Adiutor's own address.
 */
function UpdateItem({
  item,
  id,
  audience,
  locale,
  appUrl,
}: {
  item: RequestUpdateEmailItem;
  id: string;
  audience: RequestAudience;
  locale: Locale;
  appUrl: string;
}) {
  const t = translator(locale, 'emails.requestUpdate');
  const tRequests = translator(locale, 'requests');
  const who = { name: item.by, strong: strongTag };
  if (item.event === 'reply') {
    return (
      <Section>
        <EmailParagraph>{t.rich('reply', who)}</EmailParagraph>
        <WrittenText text={item.text} id={id} locale={locale} appUrl={appUrl} />
      </Section>
    );
  }
  if (item.event === 'note') {
    // Only the staff read a note: its links to their pages stay links.
    return (
      <Section>
        <EmailParagraph>{t.rich('note', who)}</EmailParagraph>
        <WrittenText text={item.text} id={id} locale={locale} appUrl={null} />
        <EmailNote>{t('noteOnlyStaff')}</EmailNote>
      </Section>
    );
  }
  if (item.event === 'mentioned') {
    return (
      <Section>
        <EmailParagraph>{t.rich('mentioned', { ...who, where: item.where })}</EmailParagraph>
        <WrittenText
          text={item.text}
          id={id}
          locale={locale}
          appUrl={item.where === 'note' ? null : appUrl}
        />
        {item.where === 'note' && <EmailNote>{t('noteOnlyStaff')}</EmailNote>}
      </Section>
    );
  }
  if (item.event === 'status') {
    return (
      <EmailParagraph>
        {t.rich('status', {
          ...who,
          change: statusChangeKind(item.from, item.to, item.bySide),
          // The statuses in the reader's words.
          from: tRequests('status', { status: item.from, audience }),
          to: tRequests('status', { status: item.to, audience }),
        })}
      </EmailParagraph>
    );
  }
  return <EmailParagraph>{t.rich(item.event, who)}</EmailParagraph>;
}

/**
 * Tells the reader what happened to a request they're on: its title and
 * number (a link to it), then each piece of news in the order it happened.
 * A reply, an internal note (only ever in an email to the staff, marked as
 * one) and a text that mentions the reader are shown in full, formatted as
 * on the request's page (`EmailMarkdown`); a status change, an assignment
 * and a subscription in a sentence, with the statuses worded for the reader.
 * A button opens the request; for someone at the company who may answer a
 * solution the email tells of, Approve and Deny buttons (`answerLinks`, links
 * that work once and only for them) take its place. A note says replies to
 * the email aren't read. The links to the request sign the reader in (`url`,
 * decision 0036), so a last note says so, and not to forward the email.
 */
export default function RequestUpdateEmail({
  appUrl,
  reference,
  title,
  companyName,
  url,
  role,
  audience,
  items,
  answerLinks = undefined,
  locale,
  logoSrc = undefined,
}: RequestUpdateEmailProps) {
  const t = translator(locale, 'emails.requestUpdate');
  const [first] = items;
  return (
    <EmailLayout
      preview={first ? t('preview', { event: first.event, name: first.by }) : title}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t.rich('reason', {
        role,
        account: accountLinkTag(`${appUrl}${REQUEST_EMAILS_PATH}`),
      })}
    >
      <EmailHeading>{title}</EmailHeading>
      <EmailNote>
        {t.rich('where', { reference, company: companyName, link: requestLinkTag(url) })}
      </EmailNote>
      {items.map((item, index) => (
        <UpdateItem
          // eslint-disable-next-line react/no-array-index-key -- the news is a fixed list, rendered once
          key={index}
          item={item}
          id={`text-${index}`}
          audience={audience}
          locale={locale}
          appUrl={appUrl}
        />
      ))}
      {answerLinks ? (
        <Section>
          <EmailParagraph>{t('answerQuestion')}</EmailParagraph>
          <EmailButton href={answerLinks.approve}>{t('approve')}</EmailButton>
          <EmailButton href={answerLinks.deny} variant="secondary">
            {t('deny')}
          </EmailButton>
          <EmailNote>{t('answerNote')}</EmailNote>
        </Section>
      ) : (
        <EmailButton href={url}>{t('button')}</EmailButton>
      )}
      <EmailNote>{t('noReply')}</EmailNote>
      <EmailNote>{t('signInNote', { days: REQUEST_LINK_DAYS })}</EmailNote>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
RequestUpdateEmail.PreviewProps = {
  ...PREVIEW_BASE,
  reference: 'AD-142',
  title: 'The printer on the second floor prints blank pages',
  companyName: 'Adiutor',
  url: 'https://adiutor.dev/api/auth/request-link/sign-in?token=example',
  role: 'subscriber',
  audience: 'contributor',
  items: [
    {
      event: 'reply',
      by: 'Sam Doe',
      text: {
        text: [
          'Thanks for the photo. Could you try these two things?',
          '',
          '1. Print the **test page** from the printer’s own menu.',
          '2. Tell us the number on the toner, e.g. `TN-2420`.',
          '',
          '> It worked until Friday.',
          '',
          'That helps: it rules out the driver.',
        ].join('\n'),
        format: 'markdown',
        mentions: {},
        attachments: [
          { name: 'test-page.pdf', size: 184_000 },
          { name: 'printer.log', size: 3_200 },
        ],
      },
    },
    { event: 'status', by: 'Sam Doe', bySide: 'staff', from: 'in_progress', to: 'waiting' },
    { event: 'assigned', by: 'Alex Doe' },
  ],
} satisfies RequestUpdateEmailProps;

/**
 * Builds the email about what happened to a request.
 *
 * @param to - Recipient address.
 * @param props - Template props.
 * @returns The email, ready to send.
 */
export function requestUpdateEmail(to: string, props: RequestUpdateEmailProps): Promise<Email> {
  return renderEmail(
    to,
    translator(props.locale, 'emails.requestUpdate')('subject', {
      reference: props.reference,
      title: props.title,
    }),
    <RequestUpdateEmail {...props} />,
  );
}
