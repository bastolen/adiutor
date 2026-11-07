/**
 * @file The error page outside the signed-in app: for the signed-out pages,
 * and for errors in the app's own layout (its navigation). Next.js shows it
 * when rendering a page or running a server action throws an error nobody
 * handled. Built like the 404 page, with the reference to send to an
 * administrator. `global-error.tsx` shows the same page when even the root
 * layout fails.
 */
'use client';

import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useTransition } from 'react';

import CenteredLayout from '@/components/layout/centered-layout';
import BackButton from '@/components/ui/back-button';
import Button from '@/components/ui/button';
import ErrorReference from '@/components/ui/error-reference';

import useErrorReference from './use-error-reference';

/**
 * Props Next.js passes to an error page.
 */
export interface ErrorPageProps {
  /** What was thrown; errors from the server carry a `digest`. */
  error: unknown;
  /** Fetches and renders the page again. */
  retry: () => void;
}

/**
 * A large, quiet icon, what happened, the reference (once it's known) and
 * the ways out: try again, the dashboard (which sends signed-out visitors to
 * sign in) and, when there's a previous page in this tab, back to it. Focus
 * moves to the heading, so screen readers announce what happened.
 *
 * @param props - Props from Next.js.
 * @param props.error - What was thrown.
 * @param props.retry - Fetches and renders the page again.
 * @returns The error page.
 */
export default function RootError({ error, retry }: ErrorPageProps) {
  const reference = useErrorReference(error);
  const [retrying, startRetry] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [error]);

  return (
    <CenteredLayout>
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <TriangleAlert
            aria-hidden="true"
            strokeWidth={1.5}
            className="size-20 text-muted-foreground"
          />
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-2xl font-semibold text-foreground outline-none sm:text-3xl"
          >
            Something went wrong
          </h1>
          <p className="max-w-sm text-base text-balance text-muted-foreground">
            This page couldn&apos;t load. Try again, or go to your dashboard.
          </p>
          {reference && <ErrorReference reference={reference.reference} at={reference.at} />}
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button loading={retrying} onClick={() => startRetry(retry)} className="w-full sm:w-auto">
            Try again
          </Button>
          <Button asChild variant="secondary" className="w-full sm:w-auto">
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
          <BackButton className="w-full sm:w-auto" />
        </div>
      </div>
    </CenteredLayout>
  );
}
