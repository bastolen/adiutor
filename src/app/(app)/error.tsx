/**
 * @file The error page inside the signed-in app: Next.js shows it in place
 * of a page when rendering it or running one of its server actions throws an
 * error nobody handled. The navigation, account menu and theme stay, and so
 * do the other pages kept alive in the background. Built like the app's 404
 * page, with the reference to send to an administrator. Errors in the app's
 * layout itself end on the root error page (`src/app/error.tsx`).
 */
'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useTransition } from 'react';

import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import ErrorReference from '@/components/ui/error-reference';

import type { ErrorPageProps } from '../error';
import useErrorReference from '../use-error-reference';

/**
 * Explains the page couldn't load, in a card in the app layout, with "Try
 * again", the way to the dashboard and the reference (once it's known).
 * Focus moves to the heading, so screen readers announce what happened.
 *
 * @param props - Props from Next.js.
 * @param props.error - What was thrown.
 * @param props.retry - Fetches and renders the page again.
 * @returns The error content.
 */
export default function AppError({ error, retry }: ErrorPageProps) {
  const t = useTranslations('common');
  const reference = useErrorReference(error);
  const [retrying, startRetry] = useTransition();
  const heading = useRef<HTMLElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [error]);

  return (
    <Card flush>
      <EmptyState
        icon={TriangleAlert}
        title={t('error.title')}
        titleAs="h1"
        titleRef={heading}
        description={t('error.description')}
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button loading={retrying} onClick={() => startRetry(retry)}>
              {t('actions.tryAgain')}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/dashboard">{t('actions.goToDashboard')}</Link>
            </Button>
          </div>
        }
      >
        {reference && <ErrorReference reference={reference.reference} at={reference.at} />}
      </EmptyState>
    </Card>
  );
}
