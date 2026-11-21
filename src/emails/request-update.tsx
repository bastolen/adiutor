/**
 * @file Email telling someone on a request what happened to it: who replied,
 * with the reply, and who changed its status. Several pieces of news about
 * one request are one email.
 */
import type { ReactNode } from 'react';
import { Link, Section } from 'react-email';

import EmailButton from '@/components/email/email-button';
import EmailLayout from '@/components/email/email-layout';
import EmailMarkdown, { type EmailText } from '@/components/email/email-markdown';
import { EmailHeading, EmailNote, EmailParagraph } from '@/components/email/email-text';
import { colors } from '@/components/email/theme';
import type { Email } from '@/lib/email';
import translator from '@/lib/i18n/translator';
import {
  isClosedStatus,
  isReopening,
  type RequestAudience,
  type RequestParticipantRole,
  type RequestStatus,
} from '@/lib/requests';

import { type EmailBaseProps, PREVIEW_BASE } from './base-props';
import renderEmail from './render';

/** One thing the email tells its reader. */
export type RequestUpdateEmailItem =
  | {
      /** Someone replied. */
      event: 'reply';
      /** Who, by the name the request's page gives them. */
      by: string;
      /** The reply, with the people it mentions by name. */
      text: EmailText;
    }
  | {
      /** Someone changed the status. */
      event: 'status';
      /** Who, by the name the request's page gives them. */
      by: string;
      /** The status it had. */
      from: RequestStatus;
      /** The status it got. */
      to: RequestStatus;
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
  /** Link to the request in Adiutor. */
  url: string;
  /** Why the reader gets the email: the request is assigned to them, or they're subscribed. */
  role: RequestParticipantRole;
  /** How to word the request's statuses for the reader. */
  audience: RequestAudience;
  /** What happened, in the order it happened. */
  items: readonly RequestUpdateEmailItem[];
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
 * @returns The tag's renderer.
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
 * What a status change did, as the sentence about it is chosen: it
 * reopened the request, marked it done or cancelled it, or moved it to
 * another status.
 *
 * @param from - The status it had.
 * @param to - The status it got.
 * @returns Which sentence tells it.
 */
function changeOf(from: RequestStatus, to: RequestStatus): string {
  if (isReopening(from, to)) {
    return 'reopened';
  }
  return isClosedStatus(to) ? to : 'other';
}

/**
 * Tells the reader what happened to a request they're on: its title and
 * number (a link to it), then each piece of news in the order it happened.
 * A reply is shown in full, formatted as on the request's page
 * (`EmailMarkdown`); a status change in a sentence, with the statuses worded
 * for the reader. A button opens the request, and a note says replies to
 * the email aren't read.
 *
 * @param props - Template props.
 * @param props.appUrl - Public app URL.
 * @param props.reference - The request's number as people see it.
 * @param props.title - The request's title.
 * @param props.companyName - The request's company.
 * @param props.url - Link to the request.
 * @param props.role - Why the reader gets the email.
 * @param props.audience - How to word the statuses.
 * @param props.items - What happened.
 * @param props.locale - The recipient's language.
 * @param props.logoSrc - Logo URL override.
 * @returns The email.
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
  locale,
  logoSrc = undefined,
}: RequestUpdateEmailProps) {
  const t = translator(locale, 'emails.requestUpdate');
  const tRequests = translator(locale, 'requests');
  const [first] = items;
  /**
   * A status in the reader's words.
   *
   * @param status - The status.
   * @returns Its name.
   */
  const statusName = (status: RequestStatus) => tRequests('status', { status, audience });
  return (
    <EmailLayout
      preview={first ? t('preview', { event: first.event, name: first.by }) : title}
      appUrl={appUrl}
      locale={locale}
      logoSrc={logoSrc}
      reason={t('reason', { role })}
    >
      <EmailHeading>{title}</EmailHeading>
      <EmailNote>
        {t.rich('where', { reference, company: companyName, link: requestLinkTag(url) })}
      </EmailNote>
      {items.map((item, index) =>
        item.event === 'reply' ? (
          // eslint-disable-next-line react/no-array-index-key -- the news is a fixed list, rendered once
          <Section key={index}>
            <EmailParagraph>{t.rich('reply', { name: item.by, strong: strongTag })}</EmailParagraph>
            <Section
              style={{
                borderLeft: `3px solid ${colors.border}`,
                margin: '0 0 20px',
                padding: '0 0 0 16px',
              }}
            >
              <EmailMarkdown value={item.text} id={`text-${index}`} locale={locale} />
            </Section>
          </Section>
        ) : (
          // eslint-disable-next-line react/no-array-index-key -- the news is a fixed list, rendered once
          <EmailParagraph key={index}>
            {t.rich('status', {
              change: changeOf(item.from, item.to),
              name: item.by,
              from: statusName(item.from),
              to: statusName(item.to),
              strong: strongTag,
            })}
          </EmailParagraph>
        ),
      )}
      <EmailButton href={url}>{t('button')}</EmailButton>
      <EmailNote>{t('noReply')}</EmailNote>
    </EmailLayout>
  );
}

/** Example data for the template preview (`pnpm email:dev`). */
RequestUpdateEmail.PreviewProps = {
  ...PREVIEW_BASE,
  reference: 'AD-142',
  title: 'The printer on the second floor prints blank pages',
  companyName: 'Adiutor',
  url: 'https://adiutor.dev/requests/142',
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
      },
    },
    { event: 'status', by: 'Sam Doe', from: 'in_progress', to: 'waiting' },
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
