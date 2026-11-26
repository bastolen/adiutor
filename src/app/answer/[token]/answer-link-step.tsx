/**
 * @file The content of an answer link's page: it looks the link up without
 * using it (`readAnswerLink`) and shows what fits. That's what the link did,
 * the button that answers, or why the link can't answer any more, with a
 * way on to the request.
 */
import {
  CircleCheck,
  CircleHelp,
  Clock,
  History,
  LinkIcon,
  type LucideIcon,
  MessageSquareText,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import Alert from '@/components/ui/alert';
import AuthHeading from '@/components/ui/auth-heading';
import Button from '@/components/ui/button';
import IconTile from '@/components/ui/icon-tile';
import { requestPath, SOLUTION_ANSWERS } from '@/lib/requests';
import { type SearchParams, searchParam } from '@/lib/search-params';
import appContext from '@/server/app-context';
import { requestStaffName } from '@/server/branding';
import { ServiceError, serviceErrorMessage } from '@/server/errors';
import { type AnswerLinkView, readAnswerLink } from '@/server/requests';

import AnswerLinkForm from './answer-link-form';

/** Where people go on from a page whose link names no request they can open. */
const HOME_PATH = '/dashboard';

/**
 * What the link did or why it can't answer, with one way on.
 *
 * @param props - Component props.
 * @param props.icon - The tile's icon.
 * @param props.success - Whether it's good news (the tile is green).
 * @param props.title - The heading.
 * @param props.description - What it means, or what to do.
 * @param props.href - Where the button goes.
 * @param props.label - The button's text.
 */
function Outcome({
  icon,
  success = false,
  title,
  description,
  href,
  label,
}: {
  icon: LucideIcon;
  success?: boolean;
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <IconTile icon={icon} tone={success ? 'success' : 'muted'} size="lg" />
      <AuthHeading title={title} description={description} />
      <Button variant="secondary" fullWidth asChild>
        <Link href={href}>{label}</Link>
      </Button>
    </div>
  );
}

/**
 * Says the link can't be looked up now (too many tries from this address).
 *
 * @param props - Component props.
 * @param props.message - What's wrong.
 * @param props.staff - The staff's name, for the way on ("Go to …").
 */
function LinkProblem({ message, staff }: { message: string; staff: string }) {
  const t = useTranslations('requests.answerLink');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('problemHeading')}</h1>
      <Alert tone="error">{message}</Alert>
      <Button variant="secondary" fullWidth asChild>
        <Link href={HOME_PATH}>{t('goHome', { staff })}</Link>
      </Button>
    </div>
  );
}

/**
 * Looks the link up and shows the step that fits. A usable link asks for a
 * button press: one button for the answer the email's button stood for
 * (`?answer=`), or Approve and Deny without one. The link's page is only
 * reached without answering when the email's button wasn't a person's click,
 * or answering was refused for too many tries.
 *
 * @param props - Component props.
 * @param props.params - Route parameters: the link's token.
 * @param props.searchParams - The query string: the answer the email's button stood for.
 */
export default async function AnswerLinkStep({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ token }, query, t, staff] = await Promise.all([
    params,
    searchParams,
    getTranslations('requests.answerLink'),
    requestStaffName(),
  ]);
  let view: AnswerLinkView;
  try {
    view = await readAnswerLink(appContext, token);
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'rate_limited') {
      return <LinkProblem message={serviceErrorMessage(error, await getLocale())} staff={staff} />;
    }
    throw error;
  }

  if (view.state === 'unknown') {
    return (
      <Outcome
        icon={LinkIcon}
        title={t('unknownHeading')}
        description={t('unknownDescription')}
        href={HOME_PATH}
        label={t('goHome', { staff })}
      />
    );
  }
  const { reference } = view;
  const toRequest = { href: requestPath(view.number), label: t('openRequest') };
  switch (view.state) {
    case 'used':
      return (
        <Outcome
          icon={view.answer === 'approve' ? CircleCheck : MessageSquareText}
          success={view.answer === 'approve'}
          title={t('usedHeading', { answer: view.answer })}
          description={t('usedDescription', { answer: view.answer, reference })}
          {...toRequest}
        />
      );
    case 'expired':
      return (
        <Outcome
          icon={Clock}
          title={t('expiredHeading')}
          description={t('expiredDescription', { reference })}
          {...toRequest}
        />
      );
    case 'overtaken':
      return (
        <Outcome
          icon={History}
          title={t('overtakenHeading')}
          description={t('overtakenDescription', { reference })}
          {...toRequest}
        />
      );
    case 'unavailable':
      return (
        <Outcome
          icon={UserX}
          title={t('unavailableHeading')}
          description={t('unavailableDescription', { reference })}
          href={HOME_PATH}
          label={t('goHome', { staff })}
        />
      );
    default: {
      const asked = SOLUTION_ANSWERS.find((answer) => answer === searchParam(query.answer));
      return (
        <div className="flex flex-col gap-6">
          <IconTile icon={CircleHelp} size="lg" />
          <AuthHeading
            title={t('askHeading', { answer: asked ?? 'none', reference })}
            description={t('askDescription', { answer: asked ?? 'none' })}
          />
          <AnswerLinkForm token={token} answers={asked ? [asked] : SOLUTION_ANSWERS} />
        </div>
      );
    }
  }
}
